package ctrlloopexcel

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/xuri/excelize/v2"
)

// Validate accepts ordinary .xlsx packages only. It never modifies upload bytes.
func Validate(data []byte) error {
	f, err := open(data)
	if err != nil {
		return err
	}
	return f.Close()
}

func open(data []byte) (*excelize.File, error) {
	if len(data) == 0 || len(data) > MaxFileBytes {
		return nil, fmt.Errorf("workbook must be an .xlsx file no larger than %d MB", MaxFileBytes>>20)
	}
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("file is not a readable .xlsx workbook")
	}
	var expanded uint64
	validType := false
	for _, entry := range z.File {
		if entry.UncompressedSize64 > MaxExpandedBytes || expanded > MaxExpandedBytes-entry.UncompressedSize64 {
			return nil, errors.New("expanded workbook exceeds the 128 MB limit")
		}
		expanded += entry.UncompressedSize64
		if strings.HasSuffix(strings.ToLower(entry.Name), "vbaproject.bin") {
			return nil, errors.New("macro-enabled workbooks are not supported; upload an .xlsx file")
		}
		if entry.Name != "[Content_Types].xml" {
			continue
		}
		r, err := entry.Open()
		if err != nil {
			return nil, errors.New("cannot read workbook content types")
		}
		var types struct {
			Overrides []struct {
				PartName    string `xml:"PartName,attr"`
				ContentType string `xml:"ContentType,attr"`
			} `xml:"Override"`
		}
		err = xml.NewDecoder(io.LimitReader(r, 1<<20)).Decode(&types)
		r.Close()
		if err != nil {
			return nil, errors.New("invalid workbook content types")
		}
		for _, part := range types.Overrides {
			if part.PartName == "/xl/workbook.xml" && part.ContentType == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" {
				validType = true
			}
		}
	}
	if !validType {
		return nil, errors.New("only .xlsx workbooks are supported")
	}
	f, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{UnzipSizeLimit: MaxExpandedBytes, UnzipXMLSizeLimit: 16 << 20})
	if err != nil {
		return nil, fmt.Errorf("cannot open workbook: %w", err)
	}
	if len(f.GetSheetList()) == 0 {
		f.Close()
		return nil, errors.New("workbook contains no worksheets")
	}
	return f, nil
}

func Inspect(data []byte) ([]SheetInfo, error) {
	f, err := open(data)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return inspect(f)
}

func inspect(f *excelize.File) ([]SheetInfo, error) {
	result := make([]SheetInfo, 0, len(f.GetSheetList()))
	for _, name := range f.GetSheetList() {
		rows, err := f.Rows(name)
		if err != nil {
			return nil, err
		}
		info := SheetInfo{Name: name}
		row := 0
		for rows.Next() {
			row++
			cells, err := rows.Columns(excelize.Options{RawCellValue: true})
			if err != nil {
				rows.Close()
				return nil, err
			}
			if len(cells) > 0 {
				info.Rows = row
				info.Columns = max(info.Columns, len(cells))
			}
		}
		err = rows.Error()
		rows.Close()
		if err != nil {
			return nil, err
		}
		result = append(result, info)
	}
	return result, nil
}

// Preview is a bounded, read-only window. Formula strings are returned as data;
// this service never evaluates formulas or follows external workbook links.
func Preview(data []byte, sheet string, startRow, rowCount, startColumn, columnCount int) (PreviewResult, error) {
	f, err := open(data)
	if err != nil {
		return PreviewResult{}, err
	}
	defer f.Close()
	sheets, err := inspect(f)
	if err != nil {
		return PreviewResult{}, err
	}
	if sheet == "" {
		sheet = sheets[0].Name
	}
	if startRow == 0 {
		startRow = 1
	}
	if rowCount == 0 {
		rowCount = 40
	}
	if startColumn == 0 {
		startColumn = 1
	}
	if columnCount == 0 {
		columnCount = 20
	}
	if startRow < 1 || startColumn < 1 || rowCount < 1 || columnCount < 1 || rowCount > MaxReadCells || columnCount > MaxReadCells || rowCount*columnCount > MaxReadCells {
		return PreviewResult{}, fmt.Errorf("request between 1 and %d cells per preview", MaxReadCells)
	}
	var info *SheetInfo
	for i := range sheets {
		if sheets[i].Name == sheet {
			info = &sheets[i]
			break
		}
	}
	if info == nil {
		return PreviewResult{}, errors.New("worksheet does not exist")
	}
	page := SheetPage{Name: sheet, StartRow: startRow, StartColumn: startColumn, Rows: []Row{}}
	for row := startRow; row <= min(info.Rows, startRow+rowCount-1); row++ {
		r := Row{Row: row, Cells: []Cell{}}
		for col := startColumn; col <= min(info.Columns, startColumn+columnCount-1); col++ {
			address, err := excelize.CoordinatesToCellName(col, row)
			if err != nil {
				return PreviewResult{}, err
			}
			cell, err := readCell(f, sheet, address)
			if err != nil {
				return PreviewResult{}, err
			}
			r.Cells = append(r.Cells, cell)
		}
		page.Rows = append(page.Rows, r)
	}
	return PreviewResult{Sheets: sheets, Sheet: page}, nil
}

func ReadRange(data []byte, sheet, startCell, endCell string) (SheetPage, error) {
	startCol, startRow, err := excelize.CellNameToCoordinates(startCell)
	if err != nil {
		return SheetPage{}, err
	}
	endCol, endRow, err := excelize.CellNameToCoordinates(endCell)
	if err != nil {
		return SheetPage{}, err
	}
	if endCol < startCol || endRow < startRow {
		return SheetPage{}, errors.New("range end must follow its start")
	}
	page, err := Preview(data, sheet, startRow, endRow-startRow+1, startCol, endCol-startCol+1)
	return page.Sheet, err
}

func readCell(f *excelize.File, sheet, address string) (Cell, error) {
	col, _, err := excelize.CellNameToCoordinates(address)
	if err != nil {
		return Cell{}, err
	}
	text, err := f.GetCellValue(sheet, address)
	if err != nil {
		return Cell{}, err
	}
	formula, err := f.GetCellFormula(sheet, address)
	if err != nil {
		return Cell{}, err
	}
	_, link, err := f.GetCellHyperLink(sheet, address)
	if err != nil {
		return Cell{}, err
	}
	// Do not expose executable/file URLs to the HTML preview. Preserve them in
	// the workbook itself; only browser-safe links become clickable in Mango.
	u, err := url.Parse(link)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
		link = ""
	}
	return Cell{Address: address, Column: col, Text: text, Formula: formula, Hyperlink: link}, nil
}

// Search searches values and formula text, with a row cursor for large sheets.
func Search(data []byte, sheet, query string, startRow, startColumn, limit int) (SearchResult, error) {
	if strings.TrimSpace(query) == "" {
		return SearchResult{}, errors.New("search text is required")
	}
	if startRow == 0 {
		startRow = 1
	}
	if startColumn == 0 {
		startColumn = 1
	}
	if limit == 0 {
		limit = 50
	}
	if startRow < 1 || startColumn < 1 || limit < 1 || limit > 200 {
		return SearchResult{}, errors.New("start_row and start_column must be positive and limit must be between 1 and 200")
	}
	f, err := open(data)
	if err != nil {
		return SearchResult{}, err
	}
	defer f.Close()
	if sheet == "" {
		return SearchResult{}, errors.New("choose a worksheet from list_workbooks first")
	}
	rows, err := f.Rows(sheet)
	if err != nil {
		return SearchResult{}, err
	}
	defer rows.Close()
	result := SearchResult{Matches: []SearchMatch{}}
	query = strings.ToLower(query)
	row := 0
	for rows.Next() {
		row++
		if row < startRow {
			continue
		}
		values, err := rows.Columns()
		if err != nil {
			return SearchResult{}, err
		}
		for col, value := range values {
			if row == startRow && col+1 < startColumn {
				continue
			}
			address, _ := excelize.CoordinatesToCellName(col+1, row)
			formula, err := f.GetCellFormula(sheet, address)
			if err != nil {
				return SearchResult{}, err
			}
			if !strings.Contains(strings.ToLower(value), query) && !strings.Contains(strings.ToLower(formula), query) {
				continue
			}
			cell, err := readCell(f, sheet, address)
			if err != nil {
				return SearchResult{}, err
			}
			result.Matches = append(result.Matches, SearchMatch{Sheet: sheet, Row: row, Cell: cell})
			if len(result.Matches) == limit {
				result.NextRow, result.NextColumn = row, col+2
				if col+1 == len(values) {
					result.NextRow, result.NextColumn = row+1, 1
				}
				return result, nil
			}
		}
	}
	return result, rows.Error()
}

func (stamp Stamp) DisplayText() (string, error) {
	if stamp.ArrivalAt.IsZero() {
		return "", errors.New("email arrival timestamp is required")
	}
	if stamp.Timezone == "" || stamp.Timezone == "Local" {
		return "", errors.New("automation timezone is required")
	}
	zone, err := time.LoadLocation(stamp.Timezone)
	if err != nil {
		return "", errors.New("automation timezone is invalid")
	}
	return stamp.ArrivalAt.In(zone).Format("1/2/06 3:04PM"), nil
}

// Apply writes literal text and a native Excel relationship, never a HYPERLINK
// formula. It returns the original bytes exactly when nothing actually changes.
func Apply(data []byte, targets []CellTarget, stamp Stamp) ([]byte, []CellChange, error) {
	text, err := stamp.DisplayText()
	if err != nil {
		return nil, nil, err
	}
	u, err := url.Parse(stamp.SourceURL)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return nil, nil, errors.New("a verified HTTPS email provider link is required")
	}
	switch strings.ToLower(u.Hostname()) {
	case "mail.google.com", "outlook.office.com", "outlook.office365.com", "outlook.live.com":
	default:
		return nil, nil, errors.New("source link must open Gmail or Outlook")
	}
	f, err := open(data)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	changes := make([]CellChange, 0, len(targets))
	seen := make(map[string]bool, len(targets))
	for _, target := range targets {
		target.Cell = strings.ToUpper(strings.TrimSpace(target.Cell))
		col, row, err := excelize.CellNameToCoordinates(target.Cell)
		if err != nil || strings.ContainsAny(target.Cell, "$:") {
			return nil, nil, fmt.Errorf("invalid cell %q", target.Cell)
		}
		canonical, _ := excelize.CoordinatesToCellName(col, row)
		if canonical != target.Cell {
			return nil, nil, fmt.Errorf("invalid cell %q", target.Cell)
		}
		key := target.Sheet + "\x00" + target.Cell
		if seen[key] {
			continue
		}
		seen[key] = true
		if len(seen) > MaxUpdates {
			return nil, nil, fmt.Errorf("at most %d cells can change in one run", MaxUpdates)
		}
		if index, err := f.GetSheetIndex(target.Sheet); err != nil || index < 0 {
			return nil, nil, errors.New("worksheet does not exist")
		}
		formula, err := f.GetCellFormula(target.Sheet, target.Cell)
		if err != nil {
			return nil, nil, err
		}
		if formula != "" {
			return nil, nil, fmt.Errorf("%s!%s contains a formula; choose the intended input cell", target.Sheet, target.Cell)
		}
		merged, err := f.GetMergeCells(target.Sheet)
		if err != nil {
			return nil, nil, err
		}
		for _, merge := range merged {
			c1, r1, _ := excelize.CellNameToCoordinates(merge.GetStartAxis())
			c2, r2, _ := excelize.CellNameToCoordinates(merge.GetEndAxis())
			if col >= c1 && col <= c2 && row >= r1 && row <= r2 && target.Cell != merge.GetStartAxis() {
				return nil, nil, fmt.Errorf("%s!%s is inside a merged cell; use %s", target.Sheet, target.Cell, merge.GetStartAxis())
			}
		}
		previous, err := f.GetCellValue(target.Sheet, target.Cell)
		if err != nil {
			return nil, nil, err
		}
		_, link, err := f.GetCellHyperLink(target.Sheet, target.Cell)
		if err != nil {
			return nil, nil, err
		}
		kind, err := f.GetCellType(target.Sheet, target.Cell)
		if err != nil {
			return nil, nil, err
		}
		if previous == text && link == stamp.SourceURL && (kind == excelize.CellTypeSharedString || kind == excelize.CellTypeInlineString) {
			continue
		}
		if err := f.SetCellStr(target.Sheet, target.Cell, text); err != nil {
			return nil, nil, err
		}
		if err := f.SetCellHyperLink(target.Sheet, target.Cell, stamp.SourceURL, "External", excelize.HyperlinkOpts{Display: &text}); err != nil {
			return nil, nil, err
		}
		changes = append(changes, CellChange{CellTarget: target, PreviousText: previous, Text: text, Stamp: stamp})
	}
	if len(changes) == 0 {
		return data, changes, nil
	}
	buffer, err := f.WriteToBuffer()
	if err != nil {
		return nil, nil, fmt.Errorf("cannot save updated workbook: %w", err)
	}
	if buffer.Len() > MaxFileBytes {
		return nil, nil, errors.New("updated workbook exceeds the 25 MB limit")
	}
	return buffer.Bytes(), changes, nil
}

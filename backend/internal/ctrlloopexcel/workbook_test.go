package ctrlloopexcel

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func fixture(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(f.SetSheetName("Sheet1", "WIP"))
	_, err := f.NewSheet("Offset layout")
	must(err)
	_, err = f.NewSheet("Formula only")
	must(err)
	values := map[string]map[string]any{
		"WIP":           {"A1": "PO", "B1": "Quantity", "C1": "Factory received", "D1": "Total", "A2": "PO-42", "B2": 12, "C2": "pending", "A3": "PO-99", "B3": 7, "H8": "Supplier portal", "I9": "Existing local file"},
		"Offset layout": {"B2": "Factory status", "C5": "Order reference", "D5": "Supplier", "E5": "Comments", "F5": "Packing complete", "C6": "Order 99/PO-42", "D6": "Example factory", "E6": "Preserve this note"},
	}
	for sheet, cells := range values {
		for address, value := range cells {
			must(f.SetCellValue(sheet, address, value))
		}
	}
	must(f.SetCellFormula("WIP", "D2", "SUM(B2:B3)"))
	must(f.SetCellFormula("Offset layout", "G6", "WIP!B2*2"))
	must(f.SetCellFormula("Formula only", "Q15", "SUM(WIP!B2:B3)"))
	must(f.SetCellHyperLink("WIP", "H8", "https://example.com/supplier", "External"))
	must(f.SetCellHyperLink("WIP", "I9", "file:///original-reference.xlsx", "External"))
	style, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Color: "116633"}, Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"DDEEFF"}}, NumFmt: 22, Alignment: &excelize.Alignment{WrapText: true}})
	must(err)
	must(f.SetCellStyle("WIP", "C2", "C2", style))
	must(f.SetCellStyle("Offset layout", "F6", "F6", style))
	must(f.SetColWidth("WIP", "A", "A", 24))
	must(f.SetRowHeight("WIP", 3, 29))
	must(f.MergeCell("Offset layout", "B2", "F2"))
	must(f.SetPanes("WIP", &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"}))
	must(f.SetDefinedName(&excelize.DefinedName{Name: "PurchaseOrders", RefersTo: "WIP!$A$2:$A$3"}))
	must(f.AddTable("WIP", &excelize.Table{Range: "A1:D3", Name: "Orders", StyleName: "TableStyleMedium2"}))
	must(f.AddComment("WIP", excelize.Comment{Cell: "A2", Author: "Planner", Paragraph: []excelize.RichTextRun{{Text: "Keep original note"}}}))
	must(f.AddChart("WIP", "J2", &excelize.Chart{Type: excelize.Col, Series: []excelize.ChartSeries{{Name: "WIP!$B$1", Categories: "WIP!$A$2:$A$3", Values: "WIP!$B$2:$B$3"}}}))
	buffer, err := f.WriteToBuffer()
	must(err)
	return buffer.Bytes()
}

func arrivalStamp() Stamp {
	return Stamp{ArrivalAt: time.Date(2026, 9, 13, 21, 31, 0, 0, time.UTC), Timezone: "America/Los_Angeles", SourceURL: "https://mail.google.com/mail/?authuser=planner%40example.com#all/18abc123"}
}

func TestApplyArrivalAcrossDaylightSavingTransitions(t *testing.T) {
	data := fixture(t)
	for _, tc := range []struct {
		utc, want string
	}{
		{"2026-03-08T09:59:00Z", "3/8/26 1:59AM"},
		{"2026-03-08T10:00:00Z", "3/8/26 3:00AM"},
		{"2026-11-01T08:59:00Z", "11/1/26 1:59AM"},
		{"2026-11-01T09:00:00Z", "11/1/26 1:00AM"},
	} {
		t.Run(tc.utc, func(t *testing.T) {
			stamp := arrivalStamp()
			stamp.ArrivalAt, _ = time.Parse(time.RFC3339, tc.utc)
			updated, changes, err := Apply(data, []CellTarget{{Sheet: "WIP", Cell: "C2"}}, stamp)
			if err != nil {
				t.Fatal(err)
			}
			book, err := open(updated)
			if err != nil {
				t.Fatal(err)
			}
			defer book.Close()
			value, err := book.GetCellValue("WIP", "C2")
			if err != nil || value != tc.want || len(changes) != 1 || changes[0].ArrivalAt != stamp.ArrivalAt {
				t.Fatalf("arrival text=%q want=%q changes=%+v err=%v", value, tc.want, changes, err)
			}
		})
	}
}

func TestApplyPreservesWorkbookAndWritesNativeArrivalLinks(t *testing.T) {
	original := fixture(t)
	hash := sha256.Sum256(original)
	targets := []CellTarget{{JobID: "job-1", Sheet: "WIP", Cell: "c2"}, {JobID: "job-1", Sheet: "Offset layout", Cell: "F6"}, {JobID: "job-1", Sheet: "WIP", Cell: "C2"}}
	updated, changes, err := Apply(original, targets, arrivalStamp())
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 2 {
		t.Fatalf("changes=%+v", changes)
	}
	if sha256.Sum256(original) != hash {
		t.Fatal("original uploaded bytes changed")
	}
	before, err := open(original)
	if err != nil {
		t.Fatal(err)
	}
	defer before.Close()
	after, err := open(updated)
	if err != nil {
		t.Fatal(err)
	}
	defer after.Close()
	for _, target := range targets {
		cell := strings.ToUpper(target.Cell)
		value, _ := after.GetCellValue(target.Sheet, cell)
		formula, _ := after.GetCellFormula(target.Sheet, cell)
		kind, _ := after.GetCellType(target.Sheet, cell)
		linked, url, _ := after.GetCellHyperLink(target.Sheet, cell)
		if value != "9/13/26 2:31PM" || formula != "" || (kind != excelize.CellTypeSharedString && kind != excelize.CellTypeInlineString) || !linked || url != arrivalStamp().SourceURL {
			t.Fatalf("invalid timestamp hyperlink: %s %s %d %v %s", value, formula, kind, linked, url)
		}
		styleBefore, _ := before.GetCellStyle(target.Sheet, cell)
		styleAfter, _ := after.GetCellStyle(target.Sheet, cell)
		if styleBefore != styleAfter {
			t.Fatal("changed timestamp cell's existing formatting")
		}
	}
	for sheet, cells := range map[string][]string{"WIP": {"A1", "B1", "C1", "D1", "A2", "B2", "D2", "A3", "B3", "H8", "I9"}, "Offset layout": {"B2", "C5", "D5", "E5", "F5", "C6", "D6", "E6", "G6"}, "Formula only": {"Q15"}} {
		for _, cell := range cells {
			v1, _ := before.GetCellValue(sheet, cell)
			v2, _ := after.GetCellValue(sheet, cell)
			f1, _ := before.GetCellFormula(sheet, cell)
			f2, _ := after.GetCellFormula(sheet, cell)
			_, h1, _ := before.GetCellHyperLink(sheet, cell)
			_, h2, _ := after.GetCellHyperLink(sheet, cell)
			s1, _ := before.GetCellStyle(sheet, cell)
			s2, _ := after.GetCellStyle(sheet, cell)
			if v1 != v2 || f1 != f2 || h1 != h2 || s1 != s2 {
				t.Fatalf("untouched cell changed: %s!%s", sheet, cell)
			}
		}
	}
	if !reflect.DeepEqual(before.GetSheetList(), after.GetSheetList()) || !reflect.DeepEqual(before.GetDefinedName(), after.GetDefinedName()) {
		t.Fatal("sheet names or named ranges changed")
	}
	t1, _ := before.GetTables("WIP")
	t2, _ := after.GetTables("WIP")
	if !reflect.DeepEqual(t1, t2) {
		t.Fatal("table changed")
	}
	p1, _ := before.GetPanes("WIP")
	p2, _ := after.GetPanes("WIP")
	if !reflect.DeepEqual(p1, p2) {
		t.Fatal("frozen pane changed")
	}
	m1, _ := before.GetMergeCells("Offset layout")
	m2, _ := after.GetMergeCells("Offset layout")
	if !reflect.DeepEqual(m1, m2) {
		t.Fatal("merged range changed")
	}
	c1, _ := before.GetComments("WIP")
	c2, _ := after.GetComments("WIP")
	if !reflect.DeepEqual(c1, c2) {
		t.Fatal("comments changed")
	}
	w1, _ := before.GetColWidth("WIP", "A")
	w2, _ := after.GetColWidth("WIP", "A")
	h1, _ := before.GetRowHeight("WIP", 3)
	h2, _ := after.GetRowHeight("WIP", 3)
	if w1 != w2 || h1 != h2 {
		t.Fatal("row or column dimensions changed")
	}
	if !bytes.Equal(zipPart(t, original, "xl/charts/chart1.xml"), zipPart(t, updated, "xl/charts/chart1.xml")) {
		t.Fatal("untouched chart changed")
	}
	if !bytes.Equal(zipPart(t, original, "xl/tables/table1.xml"), zipPart(t, updated, "xl/tables/table1.xml")) {
		t.Fatal("untouched table XML changed")
	}
	if !bytes.Contains(zipPart(t, updated, "xl/worksheets/_rels/sheet1.xml.rels"), []byte("relationships/hyperlink")) {
		t.Fatal("missing native hyperlink relationship")
	}
	if changes[0].ArrivalAt != arrivalStamp().ArrivalAt || changes[0].Timezone != "America/Los_Angeles" {
		t.Fatal("underlying arrival timestamp not retained")
	}
	again, duplicate, err := Apply(updated, targets, arrivalStamp())
	if err != nil {
		t.Fatal(err)
	}
	if len(duplicate) != 0 || !bytes.Equal(updated, again) {
		t.Fatal("duplicate event changed workbook again")
	}
	unrelated, noChanges, err := Apply(updated, nil, arrivalStamp())
	if err != nil {
		t.Fatal(err)
	}
	if len(noChanges) != 0 || !bytes.Equal(updated, unrelated) {
		t.Fatal("unrelated mail rewrote workbook")
	}
}

func zipPart(t *testing.T, data []byte, name string) []byte {
	t.Helper()
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range r.File {
		if part.Name == name {
			stream, err := part.Open()
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			data, err := io.ReadAll(stream)
			if err != nil {
				t.Fatal(err)
			}
			return data
		}
	}
	t.Fatalf("missing %s", name)
	return nil
}

func TestWorkbookInspectionSearchAndPreviewAcrossLayouts(t *testing.T) {
	data := fixture(t)
	sheets, err := Inspect(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(sheets) != 3 || sheets[0].Name != "WIP" || sheets[1].Rows != 6 || sheets[1].Columns != 7 || sheets[2].Rows != 15 || sheets[2].Columns != 17 {
		t.Fatalf("actual workbook dimensions missing: %+v", sheets)
	}
	search, err := Search(data, "Offset layout", "PO-42", 1, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(search.Matches) != 1 || search.Matches[0].Address != "C6" {
		t.Fatalf("wrong actual PO: %+v", search)
	}
	formula, err := Search(data, "Formula only", "SUM", 1, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(formula.Matches) != 1 || formula.Matches[0].Formula != "SUM(WIP!B2:B3)" {
		t.Fatalf("formula search failed: %+v", formula)
	}
	page, err := Preview(data, "Offset layout", 5, 2, 3, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Sheet.Rows) != 2 || page.Sheet.Rows[0].Cells[0].Address != "C5" || page.Sheet.Rows[1].Cells[4].Formula != "WIP!B2*2" {
		t.Fatalf("wrong paginated values: %+v", page)
	}
	links, err := ReadRange(data, "WIP", "H8", "I9")
	if err != nil {
		t.Fatal(err)
	}
	if links.Rows[0].Cells[0].Hyperlink != "https://example.com/supplier" || links.Rows[1].Cells[1].Hyperlink != "" {
		t.Fatal("preview link filtering failed")
	}
	if _, err := Preview(data, "WIP", 1, 100, 1, 100); err == nil {
		t.Fatal("unbounded preview accepted")
	}
}

func TestApplyRejectsUnsafeDestinationsAndInvalidInput(t *testing.T) {
	data := fixture(t)
	for _, target := range []CellTarget{{Sheet: "WIP", Cell: "D2"}, {Sheet: "Offset layout", Cell: "C2"}, {Sheet: "Missing", Cell: "A1"}, {Sheet: "WIP", Cell: "A1:B2"}, {Sheet: "WIP", Cell: "$A$1"}, {Sheet: "WIP", Cell: "A0"}} {
		updated, _, err := Apply(data, []CellTarget{{Sheet: "WIP", Cell: "C2"}, target}, arrivalStamp())
		if err == nil || updated != nil {
			t.Fatalf("unsafe destination accepted: %+v", target)
		}
	}
	for _, link := range []string{"https://mango.example/email/id", "javascript:alert(1)", "https://mail.google.com.evil.test/#id", "https://user@mail.google.com/#id", "http://outlook.office.com/id", "https://outlook.office.com:444/id", ""} {
		stamp := arrivalStamp()
		stamp.SourceURL = link
		if _, _, err := Apply(data, []CellTarget{{Sheet: "WIP", Cell: "C2"}}, stamp); err == nil {
			t.Fatalf("unsafe provider link accepted: %s", link)
		}
	}
	stamp := arrivalStamp()
	stamp.ArrivalAt = time.Time{}
	if _, _, err := Apply(data, nil, stamp); err == nil {
		t.Fatal("missing arrival accepted")
	}
	stamp = arrivalStamp()
	stamp.Timezone = ""
	if _, _, err := Apply(data, nil, stamp); err == nil {
		t.Fatal("missing timezone accepted")
	}
	stamp.Timezone = "Local"
	if _, _, err := Apply(data, nil, stamp); err == nil {
		t.Fatal("server-dependent Local timezone accepted")
	}
	if Validate([]byte("not an xlsx")) == nil {
		t.Fatal("arbitrary file accepted")
	}
	stamp = arrivalStamp()
	stamp.Timezone = "Asia/Tokyo"
	text, err := stamp.DisplayText()
	if err != nil || text != "9/14/26 6:31AM" {
		t.Fatalf("timezone was not respected: %s %v", text, err)
	}
}

func TestSearchCursorKeepsMatchesInSameRow(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	for _, cell := range []string{"A1", "B1", "C1", "A2"} {
		if err := f.SetCellStr("Sheet1", cell, "PO-42"); err != nil {
			t.Fatal(err)
		}
	}
	buffer, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	first, err := Search(buffer.Bytes(), "Sheet1", "PO-42", 1, 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Search(buffer.Bytes(), "Sheet1", "PO-42", first.NextRow, first.NextColumn, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Matches) != 2 || len(second.Matches) != 2 || second.Matches[0].Address != "C1" || second.Matches[1].Address != "A2" {
		t.Fatal("search cursor skipped cells")
	}
}

func TestApplyLimitCountsDistinctCellsAfterRetryDeduplication(t *testing.T) {
	data := fixture(t)
	targets := make([]CellTarget, 0, 600)
	for row := 1; row <= 300; row++ {
		address, _ := excelize.CoordinatesToCellName(26, row)
		target := CellTarget{JobID: "job-1", Sheet: "WIP", Cell: address}
		targets = append(targets, target, target)
	}
	_, changes, err := Apply(data, targets, arrivalStamp())
	if err != nil || len(changes) != 300 {
		t.Fatalf("retry counted duplicate targets toward limit: changes=%d err=%v", len(changes), err)
	}
	for row := 301; row <= 501; row++ {
		address, _ := excelize.CoordinatesToCellName(26, row)
		targets = append(targets, CellTarget{JobID: "job-1", Sheet: "WIP", Cell: address})
	}
	if _, _, err := Apply(data, targets, arrivalStamp()); err == nil {
		t.Fatal("more than 500 distinct cells accepted")
	}
}

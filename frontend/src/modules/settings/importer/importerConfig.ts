// importerConfig.ts
// 
// - Stores the main configruation options for the Mango Importer.

// Pieces to continue working on:
// - Analyze usage of ref.current.

import { createElement, RefObject } from "react";

import { type ImportToMangoHandle } from "./importerUI";
import { InlineSvg } from "./importerUIResources/inlineSVG";
import { ImportToMangoProps, MangoSettings, MangoSource } from "./importerUIResources/types";

import { locateCSVHeaders, countLinesInCSV, determineCSVType } from "./importerLogic";

import { ISpecializedParser } from "./importerLogic";
import { createFolder, setupSpecializedParserAndDisplayProgressCall, wrappedCSVParse } from "./importerLogic";
import { DEFAULT_CSV_PARSE_CONFIG } from "./importerLogic";

// 
// Importer Configuration Constants
//


// 
// Create Props for the Mango Importer.
// 

// If you need to edit the logic that occurs on certain UI events, this logic can be found below.
// TODO: Verify if this is an implementation of the "factory" pattern.
export function createMangoImporterProps(ref: RefObject<ImportToMangoHandle>): ImportToMangoProps{

  // TODO: Consider assigning specialized parsers here as well.
  const sources: Record<string, MangoSource> = {
    "Linear": { label: "Linear", mark: createElement(InlineSvg, {src:"./importerUIResources/vectors/linearMark.svg", as: "span"})},
    "ClickUp": { label: "ClickUp", mark: createElement(InlineSvg, {src:"./importerUIResources/vectors/clickupMark.svg", as: "span"})},
  }

  // TODO: Unify tracking of state across different types of imports.
  let selectedSource: string;

  let csvLineCount: number;
  let selectedCSVParser: ISpecializedParser;
  let csv: File;


  // This factory retuns a big list of options and callback functions to be called on certain UI events.
  // to pass information back, use the ref, a RefObject<ImportToMangoHandle>.
  // You may refer to the types of the importerUI to see what methods are present
  // under such an object.
  return {
    
    title: "Import to Mango",
    subtitle: "Import your data from Linear and ClickUp",

    sources: sources,

    options: [
      {
        id: "importName",
        title: "Import Name",
        description: "What you would like this import to be called in Mango.",
        type: "text",
        default: new Date().toLocaleDateString("en-CA") + " Import",
      },
      {
        id: "retainGroups",
        title: "Retain Existing Folders",
        description: "Keep the folder structure the export came with, rather than flattening it.",
        type: "toggle",
        default: true,
      },
    ],


    // On CSV Uploads.
    onFileSelected: async (file: File) => {

      csv = file;

      // TODO: Verify the file type and format is valid.

      // Identify the formart of the CSV.
      const csvHeaders = await locateCSVHeaders(file);
      const csvTyping = determineCSVType(csvHeaders);

      if(!csvTyping.importSource || !csvTyping.parser){
        console.error("Oops, we are unable to read the type of file you provided at the moment!");
        ref.current?.reject("Oops! We weren't able to identify the type of CSV you uploaded.")
        
        // TODO: Determine if a different response would be more appropriate.
        return;
      }

      selectedSource = csvTyping.importSource;
      selectedCSVParser = csvTyping.parser;

      // 
      // The CSV type should be known by this point.
      // 

      // Begin the Import Animation.
      // TODO: Determine if it is possible to extract the filename from the provided "File" object.
      ref.current?.begin({source: selectedSource});

      // Count the number of lines found in the CSV and display on the UI.
      csvLineCount = await countLinesInCSV(file);
      ref.current?.found(csvLineCount);

      // If the CSV type is known, proceed to option selection.
      ref.current?.scanned(csvLineCount);

    },

    onApiKeySubmit: () => { // Will take an "apiKey" string.
      ref.current?.reject("Oops, API Key imports are not yet ready for production at the moment.")
    },

    onConfirm: async(settings: MangoSettings) => {

      let importFolderName = settings?.["importName"]
      if(!importFolderName || typeof(importFolderName) == "boolean"){
        importFolderName = `${new Date().toLocaleDateString("en-CA")} Import`;
      }
      const importFolderID = await createFolder(importFolderName);

      // TODO: Consider keeping CSV configuration data known within the importer logic.
      // Prepare for the full parse.
      const fullCSVParseConfig = {
          ...DEFAULT_CSV_PARSE_CONFIG,
          step: setupSpecializedParserAndDisplayProgressCall(selectedCSVParser, importFolderID, csvLineCount, (itemName: string) => { ref.current?.item(itemName); }, () => {ref.current?.finish()}),

          // TODO: A cleaner adapter may be required to work with both promises and Papaparse.
          // Disable workers to allow pausing of the parser for compatability with a promise-based step-function.
          worker: false,

      };

      if(!csv){
        console.error("Something went wrong when retrieving the CSV for parsing.");
        return;
      }

      // TODO: At the moment, the parse may not have fully finished when this promise resolves, as the step function used for Papaparse
      //       needs some reshaping to accomadate async processing. Completion code 
      await wrappedCSVParse(csv, fullCSVParseConfig);
      

    },

    onCancel: () => {

      // TODO: Stop imports when imports are canceled.

    },

    onRetry: () => {

      // TODO: Possibly clear uploaded items that failed.

    },

    onOpenWorkspace: () => {

      // TODO: Verify use.
      window.history.replaceState({}, "", "/home");
      window.dispatchEvent(new PopStateEvent("popstate"));


      // TODO: Analyze other methods of returning home
      // const returnHome = UseCallback( () => {

      //   if(!onNavigate){
      //     return;
      //   }

      //   onNavigate("", { replace: true });

      // }, []);


    },

  };
}


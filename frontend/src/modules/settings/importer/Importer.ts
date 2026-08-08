// Importer.ts

//████████████████
//██ Invariants ██
//████████████████

// - The "editorSurface" for imports is: "imported".
// - Import images default to being centered.
// - Imported items are placed inside a clearly-marked import folder.

//███████████████████████
//██ Pieces to Work On ██
//███████████████████████

// TODO: Improve error handling.
// TODO: Locate official Papaparse TYpes



//█████████████
//██ Imports ██
//█████████████

import { Editor, Node } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";

// Helper code to allow us to determine the currently active company.
import {
    getActiveCompanyID,
} from "../../auth/currentCompany.js";

// Reading the auth config allows us to locate the API base.
import {
    readAuthConfig,
} from "../../auth/cognitoAuth.js";

// Import the extension pieces that extend Tiptap into Mango-flavored Tiptap.
import {
    type MangoTiptapDocument,
    createEmptyMangoTiptapDocument,
} from "../editor/tiptap/mangoTiptapDocument.js";

import { 
    createMangoTiptapExtensionOptions,
    createMangoTiptapExtensions,
    MangoAttachmentImage,
    normalizeMangoTiptapBlockIDs,
} from "../editor/tiptap/mangoTiptapExtensions.js";

// Import code that supports the uploading of Mango-Tiptap documents.
import {
    generateStableInformationID,
} from "../editor/editorTypes.js";

// Import a function that finalizes the format and layout of Tiptap-Mango images.
import { 
    createMangoTiptapAttachmentContent,
} from "../editor/tiptap/mangoTiptapRichClipboard.js";

// Import helper code to upload images to Mango's S3 Backend.
import {
    type MangoAttachmentResourceType,
    type UploadMangoAttachmentInput,
    defaultAttachmentRequestJSON,
    uploadMangoAttachment,
} from "../attachments/attachmentApi.js";

// Import the main request dispatcher and schema to parse responses.
import {
    type RequestJSONInit,
    createRequestJSON,
    requestJSON,
} from "../api/requestJSON.js";

import {
    type CompanyExplorerV2Row,
    // companyExplorerFolders,
} from "../folders/companyExplorerFolders.js";

// Import commands to create logic gates.
import {
    createWorkspaceEntityBatchCommand,
    createWorkspaceEntityBatchClientID,
} from "../workspace/workspaceEntityCommands.js";

// Import the Papaparse CSV Parser.
import Papa from "papaparse";


//█████████████████████████████████
//██ Environment Variables (env) ██
//█████████████████████████████████

// Until Mango has a unified location for environment variables, the CORS proxy link is stored here.
// TODO: Move CORS Proxy Link to a unified Mango Environment variable file.
const CORS_PROXY_PATH = "https://mango-cors-proxy.mangorts-dev.workers.dev/corsproxy/";
const API_FOLDER_CREATION_PATHNAME = "/v1/company-explorer/folders"

function assembleDocumentUploadPathname(resourceID: string, resourceType:"logic-gate", documentID="logic-gate-overview"): string{
    return `/v1/editor-json/${resourceType}/${resourceID}/documents/${documentID}?company_id=${encodeURIComponent(fetchCurrentCompanyID())}`;
}

const DEFAULT_CSV_PARSE_CONFIG = {
    delimiter: ",",
    header: true,
    worker: true,
    skipEmptyLines: true,
}

type standardizedImportFields = {
    title: string,
    documentContent: string,
    parentFolderName: string,
}

//██████████████████████████████
//██ Importer Logic Functions ██
//██████████████████████████████

// Data Fetching Functions
// These functions attempt to centralize data retrieval from other places in the codebase so that if those
// methods change (as we are working without standardized retrieval methods) they can be changed more eaisly.
// TODO: Eventually, these methods should be retired in favor of a frontend-wide data access ~API.
function fetchCurrentCompanyID(): string{
    return getActiveCompanyID().trim();
}

function fetchApiBase(): string{
    return readAuthConfig().apiBase;
}


// TODO: Add Error Handling.
async function fetchFileThroughProxy(fileUrl: string, proxyPath: string): Promise<File>{

    let proxyUrl = new URL(proxyPath);
    proxyUrl.searchParams.set("url", fileUrl);

    let request = new Request(proxyUrl);

    let response = await fetch(request);
    let blob = await response.blob();

    // Extract the provided image filename.
    const contentDisposition = response.headers.get("content-disposition");

    // TODO: Imporve Error Handling.
    if(!contentDisposition){
        throw console.error("");
        
    }


    const fileNameRegex = /filename="(?<fileName>[^\\/:*?"<>|\r\n]+)"/
    let fileName = contentDisposition.match(fileNameRegex)?.groups?.fileName;

    if(!fileName){
        fileName = "Imported File"
    }

    let file = new File([blob], fileName, {
        type: blob.type
    });

    return file;

}

// Images are uploaded and attached to a specific resource (such as a logic gate).
async function fetchAndUploadImage(href: string, targetResourceID: string, targetResourceType: MangoAttachmentResourceType){

    // Pull the contents of the image.
    // TODO: Determine if we should pull the image title from the downloaded filename or the exported filename.
    const file = await fetchFileThroughProxy(href, CORS_PROXY_PATH);

    // Upload the image to Mango's Backend.
    // Note: We are not calling "uploadBrowserAttachment" from the private frontend code.
    //       "uploadMangoAttachment" calls this code under the hood.
    // As of 8/5/2026, upload examples can be found inside "HomeParts.tsx" (For Emails) and "MangoTiptapEditor.tsx" (For Images).


    // Prepare upload metadata for mango.
    // TODO: Verify meaning and intended usage of these fields.
    function prepareUploadMetadata(): UploadMangoAttachmentInput{
        return {
            companyID: fetchCurrentCompanyID(),

            // Values provided from the enclosing function specific to the target resource
            // the current inline image should upload into.
            resourceType: targetResourceType,
            resourceID : targetResourceID,

            file: file,

            // At the moment, no dedicated "admin_import" option exists for a sourceKind selection.
            sourceKind: "user_upload",
            relationshipKind: "inline_image",

            // Optional Fields
            // informationID: null,
            // messageID: null,
            editorSurface: "imported",
            // sourceProvider: null,
            // originalWidth: null,
            // originalHeight: null,
            // signal: null,
            // onProgress: null,
        };
    }

    // Compile the parameters currently required by upload methods.
    const uploadMetadata = prepareUploadMetadata();
    const attachmentRequestJSON = defaultAttachmentRequestJSON(fetchApiBase());

    // Upload the image using the general pattern followed in other places in the codebase.
    const uploadStatus = await uploadMangoAttachment(attachmentRequestJSON, uploadMetadata);
    const attachment = uploadStatus.attachment;

    return attachment;

}

function injectImage(){

    // Reuse a method used by the official Mango Tiptap editor to create a Mango-Tiptap image block.
    // TODO: Standardize use of "title"/fetched filename. Currently both are used in different places.
    const content = createMangoTiptapAttachmentContent(attachment, "center");
}

function createMarkdownAwareMangoAttachmentImageNode(targetResourceID: string, targetResourceType: MangoAttachmentResourceType): Node{
    
    const markdownAwareMangoAttachmentImageNode = MangoAttachmentImage.extend({

        markdownTokenName: "image",
        parseMarkdown: (token: any, helpers: any) => {

            // Token attributes are provided by Marked/MarkedJS, the Markdown parsing library
            // Tiptap's Markdown parsing utility relies on.
            // The attributes provided for "Image" tokens include: "type", "raw", "href", "title", "text", and "tokens".
            const title = token.title;
            const href = token.href;

            // Return placeholder content with the image link for later fetching and parsing.
            return {
                type: "mangoAttachmentImage",
                attrs: {
                    attachmentId: href,
                    filename: "",
                    mimeType: "",
                    width: null,
                    height: null,
                    displayWidth: null,
                    displayHeight: null,
                    alignment: "center",
                    position: "break",
                    layout: "content",
                    alt: title,
                    title: title,
                },
            };
        }
    });

    return markdownAwareMangoAttachmentImageNode;
}

function convertMarkdownToMangoTiptap(markdownString: string, targetResourceID: string, targetResourceType: MangoAttachmentResourceType): MangoTiptapDocument {

    // Create a markdown image handler that is able to upload identified images and associate images with
    // the correct resource (such as a logic gate).
    const markdownAwareMangoAttachmentImageNode = createMarkdownAwareMangoAttachmentImageNode(targetResourceID, targetResourceType);

    // TODO: Enable reuse of the Mango Tiptap extensions and the conversion editor.
    // Configure the custom Mango extensions for Tiptap. Most options are unused as this editor
    // is headless and is not user-facing.
    const mangoTiptapExtensionOptions = createMangoTiptapExtensionOptions({
        editable: false,

        // Seems to hande editor drag-and-drop.
        onImageFiles: false,


        attachmentImageExtension: markdownAwareMangoAttachmentImageNode,

        // TODO: Determine if cross-user mentions may be useful to preserve in future import setups.
        // At the moment, we also aren't importing cross-user mentions.
        mentionUsers: false,
        getMentionUsers: false,

        // Seems to handle searches for other entities.
        searchEntityLinks: false,
        onEntityLinkSearchError: false,
        
    });

    // Create a Mango editor and use it to parse the provided markdown into a Tiptap document.
    const mangoTiptapExtensions = createMangoTiptapExtensions(mangoTiptapExtensionOptions);
    const conversionEditor = new Editor({
        extensions: [
            Markdown,
            mangoTiptapExtensions,
        ]
    });

    let tiptapDocument = conversionEditor.markdown.parse(markdownString);

    // Walk through the Tiptap document to fetch and upload images.
    

    // Finally, convert the Tiptap-format document into a Mango-Tiptap document.
    return convertTiptapToMangoTiptap(tiptapDocument);

}

// Wraps Tiptap documents in a Mango wrapper and assigns Mango block IDs
// for Tiptap-Mango compatability.
function convertTiptapToMangoTiptap(document: any): MangoTiptapDocument {

    let convertedDocument = createEmptyMangoTiptapDocument();

    // Replace the document part of the converted document with the provided Tiptap document.
    // Also generate the custom block IDs Mango may be using to track changes.
    // The function that generates these IDs seems to only be called on the inner content of a document.
    convertedDocument.document = normalizeMangoTiptapBlockIDs(document);

    return convertedDocument;

}

// Newly created folders are placed at the top of the explorer list.
// Returns the "entity_id" of the newly created row.
async function createFolder(folderName: string, parentFolderID: string=""): Promise<string>{
    let folderCreationStatus = await requestJSON<CompanyExplorerV2Row>(API_FOLDER_CREATION_PATHNAME, {
        method: "POST",
        body: JSON.stringify({
            company_id: getActiveCompanyID(),
            parent_folder_id: parentFolderID,
            name: folderName,
            position: 0,
        }),
    });

    return folderCreationStatus.entity_id;

}

function createLogicGate(logicGateTitle: string, parentFolderID: string){

    const newLogicGateID = createWorkspaceEntityBatchClientID("imported-logic-gate");

    // This adapter function accepts the two parameters provided during a call by
    // "createWorkspaceEntityBatchCommand" (the function that can create logic gates)
    // and injects the server's origin API base path before making a real "requestJSON" request.
    // Much of this block of code has been taken from other (non-exported) places in the codebase.
    // TODO: For some reason, custom versions of this adapter occur all over the frontend code.
    type AdaptedCreateRequestJSON = <T>(apiBase: string, path: string, init?: RequestJSONInit) => Promise<T>;
    function bindTwoCallToThreeCallRequestJSON(apiBase: string, requestJSON: AdaptedCreateRequestJSON){
        // This line makes use of a shorthand method of declaring a function.
        return <T>(path: string, init?: RequestInit): Promise<T> => requestJSON<T>(fetchApiBase(), path, init as RequestJSONInit);
    }

    const commandStatus = createWorkspaceEntityBatchCommand({
        companyID: fetchCurrentCompanyID(),
        entityKind: "logic_gate",
        folderID: parentFolderID,

        // At this moment, a brief LLM-based search suggests this is the only
        // origin that doesn't place created nodes into the default folder
        // if no folderID is provided.
        mutationOrigin: "company_explorer",
        // creatorLogicGateRACIRole: null,
        items: [{
            client_id: newLogicGateID,
            title: logicGateTitle
        }],

        // TODO: It turns out that relationships may in fact be to relate
        //       separate control nodes. Confirmation and refactoring is
        //       required.
        // TODO: Remove this 8/6/2026 note when no longer needed.
        // An official relationship rules payload can be examined under
        // /frontend/src/modules/nodes/relationshipRules.ts.
        // relationships: [{
        //     entity_id_a: parentFolderID,
        //     client_id_b: newLogicGateID,
        //     a_position: "Parent",
        //     b_position: "Child"
        // }],
        requestJSON: bindTwoCallToThreeCallRequestJSON,
    });

    const logicGateIDs = commandStatus.logicgates;

    // TODO: Before returning, better understand the return type of a logic gate fetch.
    return logicGateIDs;
}

async function attachDocumentToResource(resourceID: string, document: MangoTiptapDocument, resourceType:"logic-gate", documentID="logic-gate-overview"){

    const requestURL = assembleDocumentUploadPathname(resourceID, resourceType, documentID);

    const requestStatus = await requestJSON(requestURL, {
        method: "POST",
        body: JSON.stringify({
            operation_id: generateStableInformationID(),
            client_id: "mango-importer",
            base_revision: 1,
            schema_version: 1,
            // NOTE: It seems as if the whole wrapped Mango-Tiptap is passed in.
            document,
            annotations: [],
        }),
    });
}

async function countLinesInCSV(csv: File): Promise<number>{

    let lineCount = 0

    function stepCount(results: any, parser: any): void{
        lineCount += 1;
    }

    const csvParseConfig = {
        ...DEFAULT_CSV_PARSE_CONFIG,
        step: stepCount,
    }

    // Wait for the parse to finish.
    await wrappedCSVParse(csv, csvParseConfig);

    return lineCount;

}

// TODO: Identify optimal type of parse config.
function wrappedCSVParse(csv: File, parseConfig: any): Promise<any>{

    return new Promise((resolve, reject) => {

        function parsedCSVComplete(results: any, file: any){
            resolve(results);
        }

        const localParseConfig = {
            ...parseConfig,
            complete: parsedCSVComplete,
        };

        Papa.parse(csv, localParseConfig);

    });
}

// Parses a single line of a CSV using a parser specialized for the format of the
// current CSV. All imported items will be stored under a single parent folder.
function setupSpecializedParserAndDisplayProgressCall(specializedParser: Function, parentFolderID: string){
    return (results: any, parser: any) => {

        // TODO: Enable Error Handling
        if(results.errors) {
            console.error(results.errors)
        };

        const standardizedOutput = specializedParser(results.data);


        // Update display progress.
    }
}

function parseLinearTask(parsedCSVRow: any): standardizedImportFields{
    return {
        title: parsedCSVRow["Title"],
        documentContent: parsedCSVRow["Description"],
        parentFolderName: parsedCSVRow["Team"],
    }
}

function parseClickUpTask(parsedCSVRow: any): standardizedImportFields{

        return {
        title: parsedCSVRow["Title"],
        documentContent: parsedCSVRow["Description"],
        parentFolderName: parsedCSVRow["Team"],
    }

}

async function parseAndImport(csv: File){

    let importSource = "";

    // Get and Parse the Current Import Date
    const currentISODate = new Date();
    const currentDate = currentISODate.toISOString().split("T")[0];

    // Read the headers of the CSV.
    const headersOnlyCSVConfig = {
        ...DEFAULT_CSV_PARSE_CONFIG,
        preview: 5,
    }

    const headers = (await wrappedCSVParse(csv, headersOnlyCSVConfig)).meta.fields;

    // Branch based on the type of CSV Imported.
    let specializedTaskParser;
    if(headers.includes("ID") && headers.includes("Team") && headers.includes("Title")){
        importSource = "Linear";
        specializedTaskParser = parseLinearTask;
        
    }

    else if(headers.includes("Task ID") && headers.includes("Task Custom ID") && headers.includes("Task Link")){
        importSource = "ClickUp";
        specializedTaskParser = parseClickUpTask;
    }

    else {
        // TODO: Display an error, as other CSV formats are not currently supported.
    }

    // Setup a parent folder for the export.
    const folderName = `${currentDate} ${importSource} Import`;
    const importFolderID = createFolder(folderName);

    // Prepare for the full parse.
    const fullCSVParseConfig = {
        ...DEFAULT_CSV_PARSE_CONFIG,
        step: setupSpecializedParserAndDisplayProgressCall(specializedTaskParser, importFolderID),

    };

    await wrappedCSVParse(csv, fullCSVParseConfig);
    // TODO: Report Results.

}
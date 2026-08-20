// Importer.ts

//████████████████
//██ Invariants ██
//████████████████

// - Import images default to being centered.
// - Imported items are placed inside a clearly-marked import folder.

//███████████████████████
//██ Pieces to Work On ██
//███████████████████████


// TODO: Determine if the document upload cap can be increased.


//█████████████
//██ Imports ██
//█████████████

// TODO: Determine if the "Node" import from Tiptap core may be required in the future.
import { Editor, JSONContent } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown"; // MarkdownToken appears in the TipTap documentation, but it doesn't seem available yet.

// Helper code to allow us to determine the currently active company.
import {
    getActiveCompanyID,
} from "../../../auth/currentCompany.js";

// Reading the auth config allows us to locate the API base.
import {
    readAuthConfig,
} from "../../../auth/cognitoAuth.js";

// Import the extension pieces that extend Tiptap into Mango-flavored Tiptap.
import {
    type MangoTiptapDocument,
    createEmptyMangoTiptapDocument,
} from "../../editor/tiptap/mangoTiptapDocument.js";

import { 
    // type MangoTiptapExtensionOptions,
    createMangoTiptapExtensions,
    MangoAttachmentImage,
    normalizeMangoTiptapBlockIDs,
} from "../../editor/tiptap/mangoTiptapExtensions.js";

// Import code that supports the uploading of Mango-Tiptap documents.
import {
    generateStableInformationID,
} from "../../editor/editorTypes.js";

// Import a function that finalizes the format and layout of Tiptap-Mango images.
import { 
    createMangoTiptapAttachmentContent,
} from "../../editor/tiptap/mangoTiptapRichClipboard.js";

// Import helper code to upload images to Mango's S3 Backend.
import {
    type MangoAttachmentResourceType,
    type UploadMangoAttachmentInput,
    defaultAttachmentRequestJSON,
    uploadMangoAttachment,
} from "../../attachments/attachmentApi.js";

// Import the main request dispatcher and schema to parse responses.
import {
    // type RequestJSONInit,
    createRequestJSON,
    requestJSON,
} from "../../api/requestJSON.js";

import {
    type CompanyExplorerV2Row,
} from "../../company-explorer/companyExplorerLazyApi.js";

// Import commands to create logic gates.
import {
    createWorkspaceEntityBatchCommand,
    createWorkspaceEntityBatchClientID,
} from "../../workspace/workspaceEntityCommands.js";

// Import a helper type to parse createWorkspaceEntityBatchCommand responses.
import {
    type CompanyExplorerWorkspaceEntityBatchResponse
} from "../../company-explorer/CompanyExplorerContentModel.js";

// Import the Papaparse CSV Parser.
import Papa, {
    type ParseConfig,
    type ParseStepResult,
    type ParseResult,
    type Parser,
} from "papaparse";


//█████████████████████████████████
//██ Environment Variables (env) ██
//█████████████████████████████████

// Until Mango has a unified location for environment variables, the CORS proxy link is stored here.
// TODO: Move CORS Proxy Link to a unified Mango Environment variable file.
const CORS_PROXY_PATH = "https://mango-cors-proxy.mangorts-dev.workers.dev/corsproxy/";
const API_FOLDER_CREATION_PATHNAME = "/v1/company-explorer/folders"

function assembleDocumentUploadPathname(resourceID: string, resourceType: string="logic_gate", documentID: string="logic-gate-overview"): string{
    return `/v1/editor-json/${resourceType}/${resourceID}/documents/${documentID}?company_id=${encodeURIComponent(fetchCurrentCompanyID())}`;
}

export const DEFAULT_CSV_PARSE_CONFIG = {
    delimiter: ",",
    header: true,
    worker: true,
    skipEmptyLines: true,
}

export type standardizedImportFields = {
    title: string,
    documentContent: string,

    // Nearly all imported items are stored within logical groups Mango interprets at folders
    // such as "Teams" in Linear.
    // On some occasions an object being imported may require the creation of two folders at once,
    // such as a ClickUp SOP stored inside a folder inside a space.
    // In all cases folder name order should be specified in a top down array of strings:
    // For Example: [..., greatGrandparentFolderName, grandparentFolderName, parentFolderName]
    folderHierarchy: string[]
}

const CLICKUP_API_URLS = {
    "getAuthorizedUser": "https://api.clickup.com/api/v2/user",
    "getAuthorizedWorkspaces": "https://api.clickup.com/api/v2/team",
    "getWorkspacePlan": "https://api.clickup.com/api/v2/team/{team_id}/plan",
    "searchForDocs": "https://api.clickup.com/api/v3/workspaces/{workspace_id}/docs",
    "fetchDoc": "https://api.clickup.com/api/v3/workspaces/{workspace_id}/docs/{doc_id}",
    "fetchPageListing": "https://api.clickup.com/api/v3/workspaces/{workspace_id}/docs/{doc_id}/page_listing",
    "fetchPages": "https://api.clickup.com/api/v3/workspaces/{workspace_id}/docs/{doc_id}/pages",
    "getPage": "https://api.clickup.com/api/v3/workspaces/{workspace_id}/docs/{doc_id}/pages/{page_id}"
} as const;
export type ClickUpAPIEndpoints = keyof typeof CLICKUP_API_URLS;

// Rows are parsed with headers (creating Records) but with dynamic typing disabled, resulting in string types on both sides of the Record.
export interface ISpecializedParser {
    (parsedCSVROW: ParseStepResult<Record<string, string>>) : standardizedImportFields;
};


//██████████████████████████████
//██ Importer Logic Functions ██
//██████████████████████████████

// Data Fetching Functions
// These functions attempt to centralize data retrieval from other places in the codebase so that if those
// methods change (as we are working without standardized retrieval methods) they can be changed more easily.
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

    // TODO: Properly handle and display fetching errors.
    let response = await fetch(request);
    let blob = await response.blob();

    // Extract the provided image filename.
    const contentDisposition = response.headers.get("content-disposition");

    // TODO: Improve Error Handling.
    if(!contentDisposition){
        throw new Error("We couldn't find the metadata we were expecting when we were attempting to download your picture!");
        
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

            // TODO: Implement a custom "imported" editor surface.
            editorSurface: "logic_gate_editor",
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

    // Reuse a method used by the official Mango Tiptap editor to create a Mango-Tiptap image block.
    // TODO: Standardize use of "title"/fetched filename. Currently both are used in different places.
    return createMangoTiptapAttachmentContent(attachment, "center");

}

async function convertMarkdownToMangoTiptap(markdownString: string, targetResourceID: string, targetResourceType: MangoAttachmentResourceType): Promise<MangoTiptapDocument> {

    // Create a markdown image handler that is able to upload identified images and associate images with
    // the correct resource (such as a logic gate).
    const markdownAwareMangoAttachmentImageNode = MangoAttachmentImage.extend({

        markdownTokenName: "image",
        parseMarkdown: (token) => { // Also accepts "helpers"

            // Token attributes are provided by Marked/MarkedJS, the Markdown parsing library
            // Tiptap's Markdown parsing utility relies on.
            // The attributes provided for "Image" tokens include: "type", "raw", "href", "title", "text", and "tokens".
            const title = token.title ?? "Imported Image";
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

    // TODO: Enable reuse of the Mango Tiptap extensions and the conversion editor.
    // Configure the custom Mango extensions for Tiptap. Most options are unused as this editor
    // is headless and is not user-facing.
    const mangoTiptapExtensionOptions = {
        editable: false,

        // Seems to handle editor drag-and-drop.
        // onImageFiles: ,

        attachmentImageExtension: markdownAwareMangoAttachmentImageNode,

        // TODO: Determine if cross-user mentions may be useful to preserve in future import setups.
        // At the moment, we also aren't importing cross-user mentions.
        // mentionUsers: ,
        // getMentionUsers: ,
        
    };

    // Create a Mango editor and use it to parse the provided markdown into a Tiptap document.
    const mangoTiptapExtensions = createMangoTiptapExtensions(mangoTiptapExtensionOptions);
    // TODO: Investigate editor reuse between batch imports.
    const conversionEditor = new Editor({
        extensions: [
            Markdown,
            ...mangoTiptapExtensions,
        ]
    });

    // TODO: Properly handle issues with opening a new editor.
    if(!(conversionEditor?.markdown)){
        throw new Error("Oops, something went wrong while setting up an editor for conversion!");
    }


    // If the markdown string is empty, respond immediately with an empty Mango Tiptap Document.
    if(!markdownString || markdownString === ""){

        let emptyDocument = createEmptyMangoTiptapDocument();

        // TODO: Identify if the output of a new document creation still requires block ID normalization.
        emptyDocument.document = normalizeMangoTiptapBlockIDs(emptyDocument.document);
        return emptyDocument;

    }

    else{

        let tiptapDocument = conversionEditor.markdown.parse(markdownString);

        // Walk through the Tiptap document to fetch and upload images. As nodes can be nested, append
        // nested items to the queue.

        // Image nodes need to be "hoisted" to the root level of the document content, as not all nodes are allowed as children.
        // Here, we keep track of all top-level nodes and children "mangoAttachmentImage" nodes in the order encountered.
        let topLevelNodesInOrderOfEncounter = [];

        type depthTrackedNode = {
            node: JSONContent,
            parent: JSONContent | null;
        }

        // Mark all of the nodes in the top level of the document as root nodes.
        let nodeQueue = (tiptapDocument.content ?? []).map( (item: JSONContent): depthTrackedNode => ({node: item, parent: null}) );
        while(nodeQueue.length > 0){
            let currentDepthTrackedNode = nodeQueue.shift();
            let currentNode = currentDepthTrackedNode?.node;

            if(!currentNode || !currentDepthTrackedNode){
                throw new Error("Something went wrong while parsing image nodes.");
            }

            // If the current node is at the root (and isn't an image), push it into the top-level document array.
            if(!(currentDepthTrackedNode.parent) && !(currentNode.type === "mangoAttachmentImage")){
                topLevelNodesInOrderOfEncounter.push(currentNode);
            }
            
            // TODO: Verify this search scenario is DFS and implement a more standard searching method.
            if(currentNode.content){
                nodeQueue = [
                    ...currentNode.content.map( (item: JSONContent): depthTrackedNode => ({node: item, parent: currentNode}) ),
                    ...nodeQueue,
                ];
            }

            if(currentNode.type === "mangoAttachmentImage"){

                // Remove the current node from it's parent if it has one.
                if(currentDepthTrackedNode.parent?.content){
                    const currentNodeIndexInParent = currentDepthTrackedNode.parent.content.indexOf(currentNode);
                    currentDepthTrackedNode.parent.content.splice(currentNodeIndexInParent, 1);
                }

                const href = currentNode?.attrs?.attachmentId;

                if(!href){
                    throw new Error("HREF link improperly returned.");
                }
                
                const imageContentJSON = await fetchAndUploadImage(href, targetResourceID, targetResourceType);

                // TODO: Develop a method to stay in sync with the format of Mango Image JSONs.
                currentNode.attrs = imageContentJSON.attrs;

                // Push the node into the top-level document array.
                topLevelNodesInOrderOfEncounter.push(currentNode);

            }
        }

        // Use the updated list of top-level nodes as the document content.
        tiptapDocument.content = topLevelNodesInOrderOfEncounter;

        // Finally, convert the Tiptap-format document into a Mango-Tiptap document.
        return convertTiptapToMangoTiptap(tiptapDocument);

    }
}

// Wraps Tiptap documents in a Mango wrapper and assigns Mango block IDs
// for Tiptap-Mango compatibility.
function convertTiptapToMangoTiptap(document: JSONContent): MangoTiptapDocument {

    let convertedDocument = createEmptyMangoTiptapDocument();

    // Replace the document part of the converted document with the provided Tiptap document.
    // Also generate the custom block IDs Mango may be using to track changes.
    // The function that generates these IDs seems to only be called on the inner content of a document.
    convertedDocument.document = normalizeMangoTiptapBlockIDs(document);

    return convertedDocument;

}

// Newly created folders are placed at the top of the explorer list.
// Returns the "entity_id" of the newly created row.
export async function createFolder(folderName: string, parentFolderID: string=""): Promise<string>{

    let folderCreationStatus = await requestJSON<CompanyExplorerV2Row>(fetchApiBase(), API_FOLDER_CREATION_PATHNAME, {
        method: "POST",
        body: JSON.stringify({
            company_id: fetchCurrentCompanyID(),
            parent_folder_id: parentFolderID,
            name: folderName,
            position: 0,
        }),
    });

    // TODO: Improve error handling and properly surface errors.
    return folderCreationStatus.entity_id;

}

// TODO: Support creation of multiple logic gates at once to better utilize the batch command API.
async function createLogicGate(logicGateTitle: string, parentFolderID: string){

    const newLogicGateID = createWorkspaceEntityBatchClientID("imported-logic-gate");

    // TODO: This additional logic may not be needed, as it may be fully implemented by the "createRequestJSON" function. Cleanup may be required.
    // // This adapter function accepts the two parameters provided during a call by
    // // "createWorkspaceEntityBatchCommand" (the function that can create logic gates)
    // // and injects the server's origin API base path before making a real "requestJSON" request.
    // // Much of this block of code has been taken from other (non-exported) places in the codebase.
    // // TODO: For some reason, custom versions of this adapter occur all over the frontend code.
    // type AdaptedCreateRequestJSON = <T>(apiBase: string, path: string, init?: RequestJSONInit) => Promise<T>;
    // function bindTwoCallToThreeCallRequestJSON(apiBase: string, requestJSON: AdaptedCreateRequestJSON){
    //     // This line makes use of a shorthand method of declaring a function.
    //     return <T>(path: string, init?: RequestInit): Promise<T> => requestJSON<T>(fetchApiBase(), path, init as RequestJSONInit);
    // }

    const batchResponse = await createWorkspaceEntityBatchCommand<CompanyExplorerWorkspaceEntityBatchResponse>({
        companyID: fetchCurrentCompanyID(),
        entityKind: "logic_gate",
        folderID: parentFolderID,

        // TODO: Create an "importer" mutationOrigin.
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

        // TODO: Analyze usage.
        // requestJSON: bindTwoCallToThreeCallRequestJSON,
        requestJSON: createRequestJSON(fetchApiBase()),
    });

    const logicGateRecords = batchResponse["logic_gates"];

    const logicGateID = logicGateRecords?.[0]?.logic_gate_id;

    if(!logicGateID){
        throw new Error("Oops, something went wrong during logic gate creation and a new logic gate ID wasn't returned!");
    }

    // TODO: Before returning, better understand the return type of a logic gate fetch.
    return logicGateID;

}

async function attachDocumentToResource(resourceID: string, document: MangoTiptapDocument, resourceType: string="logic_gate", documentID: string="logic-gate-overview"){

    const requestURL = assembleDocumentUploadPathname(resourceID, resourceType, documentID);

    const requestStatus = await requestJSON(fetchApiBase(), requestURL, {
        method: "POST",
        body: JSON.stringify({
            operation_id: generateStableInformationID(),
            client_id: "mango-importer",
            // TODO: Verify the proper base_version on a new document.
            base_revision: 0,
            schema_version: 1,
            // NOTE: It seems as if the whole wrapped Mango-Tiptap is passed in.
            document,
            annotations: [],
        }),
    });

    return requestStatus;
}

export async function locateCSVHeaders(csv: File): Promise<string[]>{
    const headersOnlyCSVConfig = {
        ...DEFAULT_CSV_PARSE_CONFIG,
        preview: 2,
    };

    return (await wrappedCSVParse(csv, headersOnlyCSVConfig))?.meta?.fields ?? [];

}

export async function countLinesInCSV(csv: File): Promise<number>{

    let lineCount = 0

    function stepCount(): void{
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
export function wrappedCSVParse(csv: File, parseConfig: ParseConfig<Record<string, string>>): Promise<ParseResult<Record<string, string>>>{

    // TODO: Add proper error handling.
    return new Promise((resolve) => {

        function parsedCSVComplete(results: ParseResult<Record<string, string>>){ // Also provides "file".
            resolve(results);
        }

        const localParseConfig = {
            ...parseConfig,
            complete: parsedCSVComplete,
        };

        Papa.parse(csv, localParseConfig);

    });
}

// A closure that parses a single line of a CSV using a parser specialized for the format of the
// current CSV. All imported items will be stored under a single parent folder.
// TODO: Eventually, completion should be awaitable outside of this function. In the meantime, completion is triggered when a target number of lines is parsed.
export function setupSpecializedParserAndDisplayProgressCall(specializedParser: ISpecializedParser, rootImportFolderID: string, targetLinesParsed: number, stepCallback:(itemName: string) => void, completionCallback: () => void){

    // Keep track of the name and Mango ID of folders that have been made within the import folder.
    // NOTE: Folders should be keyed under full path so that identically named folders under different paths don't collapse into one.
    //       For example, with /Management/Documents/... and /Engineering/Documents/... all child documents would be stored in the 
    //       documents folder that appears first.
    let createdFolders: Record<string, string> = {};

    // Keep track of the number of lines being parsed at once.
    let activeParsers = 0;

    // TODO: Remove this when the number of parsed lines is not used as the end condition.
    let numberOfParsedLines = 0;

    return async (results: ParseStepResult<Record<string, string>>, parser: Parser) => {

        // Pause the parser to handle the current input.
        parser.pause();
        activeParsers += 1;

        // TODO: Enable Error Handling
        if(results.errors.length > 0) {
            console.error(results.errors);
        }

        // TODO: Consider only parsing the results.data, and properly annotating types.
        //       Specialized parsers should not generally need more information.
        const standardizedOutput = specializedParser(results);

        const logicGateName = standardizedOutput.title ?? "Imported Document";
        const documentContent = standardizedOutput.documentContent;
        const folderHierarchy = standardizedOutput.folderHierarchy;

        // TODO: Cleanup this code handling to be clearer and more concise. Different additions have accumulated to accommodate more cases.
        // Work through the folder hierarchy from top down, creating higher-level folders before lower-level folders.
        // Already created folders are cached.
        let mostRecentFolderID = null;
        for(let i = 0; i < folderHierarchy.length; i++){
            
            const currentFolderName = folderHierarchy[i];
            const currentFolderHierarchy = folderHierarchy.slice(0, (i) + 1).join(">");

            // If the current folder is at the top of the folder hierarchy, make it directly under the root import folder.
            // Otherwise, make it underneath the folder located one level up in the hierarchy.
            const parentFolderHierarchy = (i == 0) ? null : folderHierarchy.slice(0, (i - 1) + 1).join(">");
            const parentFolderID = parentFolderHierarchy ? createdFolders[parentFolderHierarchy] : rootImportFolderID;
            
            // If the parent folder ID doesn't exist even after looking it up, something went wrong during it's initial creation.
            if(!parentFolderID){
                throw new Error("Something went wrong during folder creation and a parent folder couldn't be found.");
            }

            // Create the current folder if it hasn't already been created.
            if(!(currentFolderHierarchy in createdFolders)){
                const newFolderID = await createFolder(currentFolderName, parentFolderID);
                createdFolders[currentFolderHierarchy] = newFolderID;
            }

            mostRecentFolderID = createdFolders[currentFolderHierarchy];
        }

        // Now identify the parent folder of the current logic gate being created, the last folder in the hierarchy.
        // If, for some reason, no folders were given, place the new node directly under the root import folder.
        const currentParentFolder = mostRecentFolderID ?? rootImportFolderID; // Originally: folderHierarchy.at(-1);

        // Create the containing logic gate.
        const newLogicGateID = await createLogicGate(logicGateName, currentParentFolder);

        // Parse the document content and attach it to the logic gate.
        const document = await convertMarkdownToMangoTiptap(documentContent, newLogicGateID, "logic_gate");
        await attachDocumentToResource(newLogicGateID, document);


        // TODO: Update display progress here.

        // TODO: Remove this when the number of parsed lines is not used as the end condition.
        // Resume parsing if no other parsers are active.
        activeParsers -= 1;
        if(activeParsers <= 0){
            parser.resume();
        }

        // TODO: Remove when the number of parsed lines isn't used as the end condition.
        numberOfParsedLines += 1;
        stepCallback(logicGateName);
        if(numberOfParsedLines >= targetLinesParsed){
            completionCallback();
        }

    }
}

// TODO: Remove .data accessors when the type of the .data can be determined and parsed in directly.
export function parseLinearTask(parsedCSVRow: ParseStepResult<Record<string, string>>): standardizedImportFields{
    return {
        title: parsedCSVRow.data["Title"],
        documentContent: parsedCSVRow.data["Description"],
        folderHierarchy: [parsedCSVRow.data["Team"]],
    };
}

// TODO: Remove .data accessors when the type of the .data can be determined and parsed in directly.
export function parseClickUpTask(parsedCSVRow: ParseStepResult<Record<string, string>>): standardizedImportFields{

    // Split the folder hierarchy into pieces and remove any surrounding whitespace (done using "map").
    const folderHierarchy = parsedCSVRow.data["Space Name"]?.split(">")?.map( (value: string) => value.trim() ) || [];

    return {
        title: parsedCSVRow.data["Title"],
        documentContent: parsedCSVRow.data["Description"],
        folderHierarchy,
    };

}

export function determineCSVType(headers: string[]): {importSource: string|null, parser: ISpecializedParser|null}{

    if(headers.includes("ID") && headers.includes("Team") && headers.includes("Title")){
        return {
            importSource: "Linear",
            parser: parseLinearTask,
        };
    }

    else if(headers.includes("Task ID") && headers.includes("Task Custom ID") && headers.includes("Task Link")){
        return {
            importSource: "ClickUp",
            parser: parseClickUpTask,
        };
    }

    else {
        return {
            importSource: null,
            parser: null,
        };
    }

}


// // TODO: Standardize the format of different importer methods and unify any repeated logic.
// export async function fetchThroughAPIAndImport(APIToken: string){

//     // TODO: Store import source as a higher-level enum.
//     let importSource = "";

//     // Get and Parse the Current Import Date
//     // TODO: Ensure ISO date formatting sufficiently matches local time expectations.
//     const currentISODate = new Date();
//     const currentDate = currentISODate.toISOString().split("T")[0];

//     // Determine the type of the API token provided
//     if(APIToken.startsWith("pat_")){
//         importSource = "ClickUp";
//     } else{
//         // TODO: Replace error throw with visual feedback on the interface.
//         throw new Error("Oops! We're unable to handle this type of API key right now.");
//     }

//     // TODO: Import source is displayable.

//     // TODO: Document common steps.
//     // Handle the API import based on the identified source.
//     if(importSource == "ClickUp"){

//         // Check API Key Permissions.
//         const options = {
//             method: "GET",
//             headers: {
//                 accept: "application/json",
//                 Authorization: APIToken,
//             },
//         };
//         const response = await fetch(CLICKUP_API_URLS["getAuthorizedWorkspaces"], options)
//             .then(res => res.json())
//             // .then(res => console.log(res))
//             .catch(err => console.error(err));

        
//         // TODO: Implement workspace selection in the UI. For now, the first workspace is selected.
//         let selectedWorkspace = response?.teams?.id;

//         // TODO: Catch and display authentication errors.
//         if(!selectedWorkspace){
//             throw new Error("Oops, something went wrong while testing the provided API credential.");
//         }




//     }

//     // TODO: Report Results.

// }
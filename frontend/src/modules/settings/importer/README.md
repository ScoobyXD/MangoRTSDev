# Max's Importer Notes

**Welcome!**

If you've arrived here you're likely a LLM-powered agent or human contributor!

This file combines:

- An introduction to the Importer Module
- Some notes from my explorations of the LLM-generated codebase around August 2026
- Some suggestions on next step for the importer and more broadly for project codebase health


**A warning for future human contributors:**

My name is Max -- I'm a recently graduated undergraduate student. TypeScript and web development isn't my main specialty, but I took some time to work on this importer feature around August 2026. Overall, many features in the frontend seem to be working, but the overall coherency of the code requires work. While building this feature, mechanisms utilized by other parts of the frontend to do certain tasks had to be located, reverse-engineered, and compared against similar but unique implementations in other places. *The establishment of a frontend-facing API (and related documentation) would likely be a major step in improving codebase health.* This may or may not have been done by the time you work with the codebase, and if it hasn't, figuring out some calls might take some time. In either case, good luck!


<br>

---

<br>


## How does the importer Work?

As of 8/17/2026

### Introduction

- The Importer is a TypeScript module that is designed to allow MangoRTS to support the ingestion and conversion of data from 3rd-party sources into MangoRTS-equivalent representations.

- The Importer module exports drop-in React components that can be used to display an importer button and modal.

- Importer files are stored in a module under `/frontend/src/modules/settings/importer/` relative to the root of the main GitHub repository.


### What are each of the files for?

#### Primary Files

| File Name             | Purpose                                                                       | Start Here If...                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **importerConfig.ts** | Configure high-level importer options & manage the high-level import flow.    | - You want to change the order of steps performed during an import.<br>- You want to add or remove options set by users before/during an import.                    |        
| **importerLogic.ts**  | Handles data parsing and importer interface with other MangoRTS frontend code | - You want to add support for importing data from more companies and formats<br>- MangoRTS frontend code changes and the importer integration needs to be updated.  |
| **importerUI.tsx**    | Establishes the structure of the importer card and interface.                 | - Not currently recommended as a starting place; useful for working with more advanced React features.                                                              |


#### Supporting Files

These files provide assets, logic, typing, and related utilities utilized by the importer.

| File Path                                 | Purpose                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| **importerUIResources/types.ts**          | Typing information for the Mango Importer React components and action-driven callbacks  |
| **importerUIResources/importerUIAPI.ts**  | Manages states and triggers automatic transitions in the Importer UI                    |
| **importerUIResources/vectors/***         | Stores vector logos of companies you can import from                                    |
| **importerUIResources/inlineSVG.tsx**     | Helper code to load SVGs as React components for the site                               |
| **importerUIResources/importToMango.css** | Main CSS Styling and CSS Animations for the Importer UI                                 |
| **importerUIResources/dotCursor.css**     | CSS Styling for a custom dot icon to replace the mouse pointer on the import modal      |


### How do you use the importer?
1. On a React `tsx` page import the `SimpleMangoImporter` component from `modules/settings/importer/importerUI`. Make sure your path to the `modules` folder matches your location relative to the frontend source folder hierarchy.
2. Within the content of the `tsx` file, use the component:

    ```typescript:/frontend/[Your file's path...]
    <SimpleMangoImporter />
    ```

<br>

> **Note**
> - The `SimpleMangoImporter` is the preferred way to use the importer. A more advanced `ImportToMango` component is also available for import from the importerUI file that exposes direct control over callbacks for UI-driven events. Usage of this component requires comprehensive understanding of the importer's type and callback mechanics.
> - If you'd like to adjust the importer flow, I'd recommend looking at the default code used by the simple importer under `importerConfig.ts`.

### How does the importer work?
When the `<SimpleMangoImporter />` component is imported and used in a nearby file, a few things happen automatically to assemble your very own importer:
1. An instance of the default importer options and configuration is imported and taken from the `importerConfig.ts` file. This includes configuration options exposed to users at import time *and* the actual high-level logic that guides the information flow across the entire process.
2. When the user triggers an event (such as uploading a CSV file) the appropriate functions in the `importerConfig.ts` file are called back.<br>These functions in turn call logic in the `importerLogic.ts` with requests to do things such as `determineCSVType()` or `wrappedCSVParse()`.
    - For each acceptable CSV format a few things are done inside `importerLogic.ts`:
        - For each CSV source, a function is declared (such as `parseLinearTask`) that conforms to the interface `ISpecializedParser`. Functions that implement this interface are provided a PapaParse step result representing the contents of a single row such as:
            ```json
            {
              "[column1Header]": "[currentRowColumn1Value]",
              "[column2Header]": "[currentRowColumn2Value]",
              "[...]": "[...]",
            }
            ```
          It then returns an object of type `standardizedImportFields` that contains things such as the `title`, `documentContent` and `folderHierarchy[]` used in creating an equivalent Mango logic gate.
3. Once a user has confirmed that an import should proceed, `importerConfig.ts` dispatches a call to `setupSpecializedParserAndDisplayProgressCall()` declared within `importerLogic.ts` which assembles a step callback for PapaParse that parses and uploads the data to Mango. This assembly requires:
        - The specific CSV parser to use while parsing (determined in advance)
        - The root folder containing the entire import
        - The target number of lines to parse (*A temporary MVP limitation)
        - The function to call on completion of parsing (*A temporary MVP limitation)
4. PapaParse is called to parse the provided CSV using a promise wrapper (`wrappedCSVParse()`).
    - Both ClickUp and Linear exports include download links to image attachments that do not require authentication. A user's browser cannot fetch these directly due to CORS security restrictions (these images are stored on a different website than MangoRTS). The official MangoRTS backend also requires modifications before it can proxy upload these images. In the meantime, a workaround has been deployed, which proxies requests through a Cloudflare worker. 100,000 free requests are supported per day/up to 100,000 images can be imported per day.

### How do I...

#### Support a new CSV Import?

Inside `importerLogic.ts`:

1. Implement a new specialized parser that conforms to `ISpecializedParser`. This parser should take a headers-aware PapaParse row/parse step of your new CSV type and return the Mango-required fields specified by `standardizedImportFields`. You may refer to `parseLinearTask` and `parseClickUpTask` as reference implementation examples.
2. Inside the function `determineCSVType` expand the if/else block to include a test for your CSV type based on the headers expected in your CSV. Your execution branch should return a string `importSource` and your custom `parser`.
3. Add a logo representing your new source under the folder `importerUIResources/vectors/` and append it to the sources dictionary in `sources` under `importerConfig.ts` matching the string key you just created. Make sure to import the vector inside the file header.
4. Congratulations! You just added support for a new type of CSV!

#### Fix something that stopped working after other Mango Frontend code changed?

Inside `importerLogic.ts`:

1. Identify the functions, and/or variables that changed in other places of the frontend code. I would recommend using a Node.js/NPM container to statically typecheck and evaluate the build to identify issues with the importer. Stronger debugging may be required if names remained implemented but have subtly altered behavior.
2. In each place that refers to the changed names, replace affected code in `importerLogic.ts` with versions that use the new frontend interfaces and replicate the originally intended behavior.
3. Good luck... At the time of importer development, LLM-generated Mango frontend code requires some patience to trace out and understand.

<br>

---

<br>

## What's Next?

### Tasks Urgent and Requiring Codebase Exploration
A few tasks are urgent, but remain pending because they require further untangling of how other things work (or usually work) across other locations in the LLM-generated frontend:

- Error handling should be improved, made comprehensive, and follow a standardized frontend error format. Many things in the importer remain uncaught and are not sufficiently robust to handle unique edge cases that may happen in production.
- Verify the intention of fields used in other places in the MangoRTS frontend that are reused at import time by the importer. Some fields such as "informationID", "relationshipKind", and "signal" available in the type `UploadMangoAttachmentInput` require more documentation.
- It may be possible to reuse instances of MangoTiptap extensions and the editor used for converting markdown documents to the MangoTiptap version to improve import time.
- Verify uses of requestJSON and similar JSON request code
- Verify creating logic gates with a `base_revision` of `0` is the intended use of this field.

### Tasks Requiring Deeper Codebase Modifications
A few tasks that would improve the importer require alterations to the frontend or backend:

- A custom `editorSurface`, `mutationOrigin`, and image source should likely be allowed by the backend and be listed in the frontend so that imported content can be easily identified in the database.
- To decrease sprawl (and reduce the surface area of potential attacks) the CORS work currently performed by the Cloudflare Worker proxy should be moved to the Mango backend. Some image fetching code already exists, but this would need adaptations to serve the import purpose.
- Consolidation of importer environment variables into a single frontend environment file.
- Preserving other metadata often provided by 3rd-party exports (such as @mentions of other users) and converting into MangoRTS equivalents.

### Importer Quality Improvements
Other tasks primarily improve the quality of the importer:

- Usage of the ClickUp document API to query, download, and import ClickUp SOP documents.
- Duplication detection and de-duplication of imports
- Support for concurrently uploading attachments and creating logic gates
- Support for non-`data:image`/Base64 string attachments embedded in 3rd-party sources (such as PDFs and videos)
- Enhanced consideration of 3rd-party rate limits for fetching items such as image attachments.
- Centralized code to handle 3rd-party rate limits, timeouts, retries, and other errors
- Support cancellation of imports
- Determine a better solution to wrapping PapaParse parsing in a promise that takes the completion of async step functions into account. (workChain/method chaining solutions have been proposed, but require further investigation and analysis). This should include a removal of line-count-based import mechanisms.
- The logos currently in use for ClickUp and Linear are LLM-generated traces of the original logos. More official logos may replace these later in a future release.
- Determine if image filenames should be pulled from the image title inside export CSV files or from the filename exposed at 3rd-party fetch time.
- Determine if the MangoTiptap node search is a DFS scenario, and if so, standardize the search code.
- Clean up the MangoTiptap root/image node search and avoid duplication of images stored at the root of the document.
- Evaluate passing a dictionary-like object to specialized parsers as opposed to the full PapaParse `ParseStepResult<Record<string, string>>`.
- Clean up the code involving the creation of folder hierarchies at import time.
- Remove commented-out development code.
- Streamline image importing process and implement auto-discovery of source images by filename.
- Vectors (images) are currently stored inside importerUIResources/vectors as opposed to the frontend's public folder to improve separation from the main frontend code. It may be relocated later if desired.

### Recommendations to Improve Codebase Health:
- A centralized, documented, frontend client API (pulling together code that communicates with the backend and performs frontend operations) would accelerate both ongoing codebase maintenance (by reducing the amount of duplicated logic that needs to be maintained) and expansion (by providing high-level logic that can be quickly repurposed for new use cases). Such an effort would also greatly reduce the surface for bugs and other issues upon which to settle on as elements of the codebase change.
  - It would be useful for enum-like options and other typing information to be centralized in a single type-oriented file. Such information is often repeatedly declared at the top of individual files.
  - In many places, frontend code is rewritten with small variations, such as multiple backend API versions (that require the tracing of many branches to diagnose) such as the RequestJSON generics wrappers and BatchCommand calls.
- Across the codebase, improved documentation and logic commenting would be useful for human developers to begin working with the codebase.
- Eventually, MangoRTS might want to adopt React 19 and the React compiler. Some areas of the frontend apply React optimizations (such as `useMemo` to certain areas of the code. With the codebase using the amount of LLM-generated code (LLMs, whose context limits may prevent consistent application of such optimizations), MangoRTS might experience better performance and improved human readability.
- I would be curious to know more about the original intent of the batch command system (accessible through `createWorkspaceEntityBatchCommand` function). A possibly arbitrary limit of 200 simultaneous commands can be requested, but the codebase seems to use this endpoint to perform single-resource updates. It might be useful to have a single command function as well requiring fewer options and a simplified output format.
- Possible Areas of Simplification:
  - The extended format of Mango-flavored Tiptap seems to add a significant amount of complexity on top of the Tiptap document format. This extended format could also use a significant amount more documentation.
    - Would it be possible to simplify the Mango-Tiptap document format, such as by removing individual block IDs or identifying if Tiptap natively provides similar functionality?
    - It would likely be safer and easier to maintain version control if MangoRTS switched to a production-ready versioning (and possibly collaboration system). Versioning seems to add a significant amount of complexity into the document format itself, which seems to be a recipe for trouble later.
    - If the format of Mango-Tiptap documents can't be changed, more documentation would be useful, as well as clearly callable convenience functions to perform common operations within the format.
    - You may wish to do some research on whether or not Markdown-native formats and alternative editors exist. Tiptap seems to be leaning towards Markdown, but adoption seems slow and not fully consistent yet.
  - In at least one place, calls can be flattened to improve readability and reduce flow complexity.
    - For example, when creating/normalizing a document in `MangoTiptapEditor.tsx` normalization of Block ID is done by calling `initialDocument` -> `documentWithUniqueBlockIDs` -> `normalizeMangoTiptapBlockIDs` (the actual imported function that is declared for this job). Reducing the call chain improves the ease of understanding and working with the code.
  - The Amazon S3 upload code seems to add an extreme amount of complexity to the upload process. Is this the standard method of uploading to S3, or are there established libraries that could maintain this code for MangoRTS?
- Possible improvements to improve the professionalism of the codebase:
  - A codebase style/convention guide would be useful to give the naming, typing, and calling across the codebase a more professional and consistent feel.
  - Standardization of codebase error handling might consider:
    - What kinds of errors should be printed to the console, when, and when should the be backend be informed?
    - How should errors messages be formatted?
    - How should errors be presented to users and how should the UI or current flow under action appear to respond?

### Possible Codex Workflow Suggestions
If you ever have trouble with LLM context windows or keeping context across fresh LLM/agent threads, you might want to try using a task board such as GitHub Issues:
  - You can create an ongoing agent with a lighter-weight model that understands the codebase and converts your freeform feature requests into individual "issue" units.
  - You have a quite built-up set of agent instructions in `AGENTS.md` that should be able to ground the context of new agent threads. Here you can also ask agents to pickup ~10 related issues, claim them in comments, and close them upon successfully implementing and merging in a pull request.
  - This workflow would also let you specify big batches of backlog work upfront, prioritize tasks, and view a unified view of what your agents are working on.
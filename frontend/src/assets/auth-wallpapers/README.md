# Login wallpapers

Put each distinct scene in its own folder here. Five scenes means five folders; each folder can contain several sizes of that same scene.

```text
frontend/src/assets/auth-wallpapers/
  01-city/
    720x1280.webp
    1080x1920.webp
    1920x1080.webp
    2560x1440.webp
    3840x2160.webp
  02-mountains/
    1080x1920.jpg
    2560x1440.jpg
```

Name each file with its actual pixel dimensions: `WIDTHxHEIGHT.ext`. Use lowercase `.jpg`, `.jpeg`, `.png`, `.webp`, or `.avif`. Use one file per width within each portrait or landscape group. Folder names control alphabetical playback order; the numbers above are optional. Files in this example are examples only and are not requested until they exist.

The five sizes shown are suggested exports, not five required scenes or five required files. Missing sizes and a missing portrait or landscape group are allowed. Keep each orientation's exports of a scene at the same crop and aspect ratio. Images fill the viewport without stretching; edges crop from the center, so keep important details near the center. Portrait windows use portrait exports when present. The browser chooses an available resolution for the window shape, cover crop, and display pixel density.

Adding, replacing, or deleting images needs no component edit. Commit the files and publish them with the normal frontend deployment. Vite discovers these repository files at build time and the existing deployment publishes the emitted assets. Direct uploads to the frontend bucket are not this workflow; its normal sync can delete files absent from the build.

With no photos, the login page keeps its CSS background. Only the current scene and the next scene are mounted. After roughly a minute, the next scene loads and decodes before a gentle fade; a failed scene is skipped until the page reloads. One scene stays still. Rotation pauses while the page is hidden and remains still when reduced motion is preferred. Wallpaper changes do not reset the login forms.

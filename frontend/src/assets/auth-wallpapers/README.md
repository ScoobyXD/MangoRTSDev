# Login wallpapers

Put each distinct scene in its own folder here. A scene can be a still image or a subtle looping video (a cinemagraph). Five scenes means five folders; each folder can contain several image sizes of that same scene.

```text
frontend/src/assets/auth-wallpapers/
  01-city/
    loop.mp4
    720x1280.webp
    1080x1920.webp
    1920x1080.webp
    2560x1440.webp
    3840x2160.webp
  02-mountains/
    1080x1920.jpg
    2560x1440.jpg
```

For a moving scene, add `loop.mp4` (H.264) or `loop.webm` in its folder. Supply one clip per scene; MP4 takes priority if both filenames exist. Export a short seamless loop, ideally around 5–15 seconds, with a fixed camera and subtle movement. Remove the audio track and compress the clip before adding it. Playback is always muted, loops automatically, and has no player controls. Videos fill the viewport and crop from the center, so keep important details near the center.

Include a matching still image for reduced motion and playback failures. If a video has no still, reduced motion uses the gradient; if playback fails, the scene is skipped. A still-only folder continues to work as a photo wallpaper.

Name each still image with its actual pixel dimensions: `WIDTHxHEIGHT.ext`. Use lowercase `.jpg`, `.jpeg`, `.png`, `.webp`, or `.avif`. Use one file per width within each portrait or landscape group. Folder names control alphabetical playback order; the numbers above are optional. Files in this example are examples only and are not requested until they exist.

The five sizes shown are suggested exports, not five required scenes or five required files. Missing sizes and a missing portrait or landscape group are allowed. Keep each orientation's exports of a scene at the same crop and aspect ratio. Images fill the viewport without stretching; edges crop from the center, so keep important details near the center. Portrait windows use portrait exports when present. The browser chooses an available resolution for the window shape, cover crop, and display pixel density.

Adding, replacing, or deleting images or clips needs no component edit. Commit the files and publish them with the normal frontend deployment. Vite discovers these repository files at build time and the existing deployment publishes the emitted assets. Direct uploads to the frontend bucket are not this workflow; its normal sync can delete files absent from the build.

With no assets, the login page keeps its CSS background. Only the current scene and the next scene are mounted. After roughly a minute, the next image decodes or the next video starts playing before a gentle fade; a failed scene is skipped until the page reloads. A single scene stays selected while its video loops. Rotation and video playback pause while the page is hidden. Reduced motion loads only a still image and disables rotation. Wallpaper changes do not reset the login forms.

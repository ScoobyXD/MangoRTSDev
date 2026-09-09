type WallpaperVariant = { url: string; width: number; height: number };
type WallpaperSource = { src: string; srcSet: string; sizes: string };
export type WallpaperScene = { id: string; portrait?: WallpaperSource; landscape?: WallpaperSource; video?: string };

function sourceFor(variants: WallpaperVariant[]): WallpaperSource | undefined {
  if (!variants.length) return undefined;
  const sorted = variants.sort((a, b) => a.width - b.width);
  // Width descriptors must be unique, even if a folder accidentally contains two formats.
  const unique = sorted.filter((variant, index) => index === 0 || variant.width !== sorted[index - 1].width);
  const ratio = Math.max(...unique.map((variant) => variant.width / variant.height));
  return {
    src: unique[0].url,
    srcSet: unique.map((variant) => `${variant.url} ${variant.width}w`).join(", "),
    // Cover cropping can need more pixels than the viewport width on tall windows.
    sizes: `(min-aspect-ratio: ${ratio}) 100vw, ${Number((ratio * 100).toFixed(4))}vh`,
  };
}

export function buildWallpaperScenes(files: Record<string, string>): WallpaperScene[] {
  const scenes = new Map<string, { portrait: WallpaperVariant[]; landscape: WallpaperVariant[]; video?: string }>();
  for (const path of Object.keys(files).sort()) {
    const video = /\/auth-wallpapers\/([^/]+)\/loop\.(?:mp4|webm)$/.exec(path);
    if (video) {
      const scene = scenes.get(video[1]) ?? { portrait: [], landscape: [] };
      // Alphabetical order prefers MP4 when both formats are supplied.
      scene.video ??= files[path];
      scenes.set(video[1], scene);
      continue;
    }
    const match = /\/auth-wallpapers\/([^/]+)\/([1-9]\d*)x([1-9]\d*)\.(?:avif|jpe?g|png|webp)$/.exec(path);
    if (!match) continue;
    const [, id, widthText, heightText] = match;
    const width = Number(widthText);
    const height = Number(heightText);
    const scene = scenes.get(id) ?? { portrait: [], landscape: [] };
    scene[height > width ? "portrait" : "landscape"].push({ url: files[path], width, height });
    scenes.set(id, scene);
  }
  return Array.from(scenes, ([id, variants]) => ({
    id,
    portrait: sourceFor(variants.portrait),
    landscape: sourceFor(variants.landscape),
    video: variants.video,
  }));
}

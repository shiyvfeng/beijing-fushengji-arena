export function isPermittedRuntimeAssetPath(path: string): boolean {
  const isLocalPublicAsset = path.startsWith("./assets/");
  const isBuildInlinedImage = /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,/i.test(path);
  return (isLocalPublicAsset || isBuildInlinedImage) && !/^(?:https?:)?\/\//i.test(path);
}

export function isPermittedRuntimeAudioPath(path: string): boolean {
  const isLocalPublicAsset = path.startsWith("./assets/audio/");
  const isBuildInlinedAudio = /^data:audio\/(?:mpeg|wav);base64,/iu.test(path);
  return (isLocalPublicAsset || isBuildInlinedAudio) && !/^(?:https?:)?\/\//iu.test(path);
}

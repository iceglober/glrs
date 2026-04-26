declare const __GLORIOUS_VERSION__: string;

export const VERSION: string =
  typeof __GLORIOUS_VERSION__ !== "undefined" ? __GLORIOUS_VERSION__ : "0.0.0-dev";

/*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/errors/ambient-light-error.js
 * at commit 63585027ebcd09a2aa4be0d5aeebe9c7f3837b0f (v2.38.17). Copied unchanged.
 * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in vendor/ambilight/LICENSE. */
export class AmbientlightError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

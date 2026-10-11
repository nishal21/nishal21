/*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/errors/ambient-light-error.js
 * at commit 18d17188e5562e5ee913f005192d30c9a60be078. Copied unchanged.
 * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
export class AmbientlightError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

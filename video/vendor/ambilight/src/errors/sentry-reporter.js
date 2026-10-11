/* Stand-in for youtube-ambilight's errors/sentry-reporter.js (not copied): this page sends no error reports,
   it only logs them to the console. Written for nishal21's video page. */
export default class SentryReporter {
  static captureException(ex) {
    console.warn('ambient light:', ex);
  }
}

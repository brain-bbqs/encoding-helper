// Where a demo session's video sits in the BEP047 layout the archive publishes.

export function demoVideoPath(session: string, ext: string): string {
  return `sub-01/ses-${session}/beh/sub-01_ses-${session}_video.${ext}`;
}

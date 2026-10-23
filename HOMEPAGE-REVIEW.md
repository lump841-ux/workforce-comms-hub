# Twanova homepage media repair — local review only

## Source and scope
Based on `lump841-ux/workforce-comms-hub`, main commit `78c7d62ed957029d6aec8c4db64df68191b79e0e`, `prototype/index.ts`.
The source contains the identical expired HeyGen MP4 URL and sample-agency CTA observed at the public video homepage. Railway's deployed commit remains unverified because its connection requires reauthentication.

This is a narrow review patch, not a rebuild. Nothing has been pushed, deployed or published.

## Changes
- Replace expiring provider MP4/poster URLs with packaged, same-origin assets.
- Add allowlisted GET/HEAD media serving and byte-range support for video seeking.
- Reject unknown media paths, unsupported methods and malformed ranges.
- Clearly label the recovered video as an archived concept with illustrative screens, not verified app behavior.
- Label the Render link “Explore Sample Agency Demo,” with a statement that its fictional browser data does not affect the operational Hub.
- Preserve existing operational account links.

## Important content gate
The recovered 52.823-second video is an older concept with generated interfaces, a HeyGen watermark and an inaccurate language subtitle. It is included only to validate the media repair in a local preview. It must not become the public product demonstration. Replace it with reviewed, verified app footage before release.

## Run locally
Use Bun 1.4.4 or compatible runtime, then:

    cd prototype
    PORT=4327 bun run index.ts

Open localhost:4327 on the same computer. This is not a published/shareable URL.

## Additional layout repair
Navigation wraps into a distinct row below 1400px, with mobile horizontal navigation and visible account buttons. The video anchor offset tracks the actual sticky-header height with ResizeObserver. Visual verification is still blocked.

## Tests
From this directory:

    BUN_BIN=/absolute/path/to/bun node test/homepage-media.mjs

Result: 15/15 HTTP integration checks passed against Bun. `evidence/media-tests.txt` records the results. `evidence/media-probe.json` records MP4 metadata.

Verified: homepage disclosure and operational links, full MP4 byte integrity, HEAD response, bounded/suffix/open ranges, invalid ranges, unknown media path, unsupported method, poster MIME/content.

Not tested: browser playback/audio, physical phone behavior, deployed Railway revision, external signup/login completion, video accessibility captions, marketing claims outside this narrow patch.

## Review files
`homepage-media.patch` is the text-only patch for `prototype/index.ts`. Apply it only to its stated baseline after comparing the currently deployed version. Copy the two packaged files in `prototype/media/` with the patch. Do not deploy this old concept video as final marketing content.

## Browser access limitation
Cloud browser navigation to http://127.0.0.1:4327/ failed twice with `net::ERR_CONNECTION_REFUSED`, including after Bun reported listening. The local server is reachable inside the executor test process, but not through the available cloud-browser connection. No after-change screenshot or browser playback pass is claimed.

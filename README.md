# FR24 Filter Colours

A Chrome extension that overlays coloured dots on [Flightradar24](https://www.flightradar24.com) so you can instantly see which of your filters an aircraft belongs to, without having to enable filters one at a time.

It also marks airports from your filters directly on the map, colour-coded by country.

<img width="1850" height="1060" alt="image" src="https://github.com/user-attachments/assets/7b3c89f4-fc96-4839-87ec-1c7b2c359c38" />
<p align="center">
  <img width="312" height="569" alt="Screenshot 2026-07-07 at 15 47 07" src="https://github.com/user-attachments/assets/a8da7a6f-9321-4d89-bb4c-d677f5048747" />
  <img width="312" height="569" alt="Screenshot 2026-07-07 at 15 47 19" src="https://github.com/user-attachments/assets/a4e674be-f43e-4d6a-8101-735c4a3e992b" />
</p>

---

## What it does

- Draws a **coloured dot** on each aircraft that matches one of your FR24 filters
- Shows a **label to the left** of the dot with the aircraft's altitude and which colour group it belongs to
- Draws a **small coloured dot** on airport locations pulled from your FR24 filters, colour-coded by country
- Colour groups and filter assignments **sync across devices** via your Google account

---

## Installation

This is an unpacked extension, it isn't on the Chrome Web Store.

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the folder containing this extension
5. Navigate to [flightradar24.com](https://www.flightradar24.com) and the extension activates automatically

> **Syncing across devices:** because this is an unpacked extension, both installs must use the same copy of the folder (e.g. via Google Drive). The `"key"` field in `manifest.json` ensures both devices share the same extension ID so `chrome.storage.sync` works correctly.

### About the `"key"` field in manifest.json

Unpacked extensions normally get a random ID each time they are loaded, which would break sync because Chrome namespaces storage by extension ID. The `"key"` field is an RSA public key that Chrome uses to derive a stable, consistent ID instead.

It is safe to share publicly. It is the public half of a key pair and reveals nothing sensitive. Anyone can verify this is standard practice in the [Chrome extension documentation](https://developer.chrome.com/docs/extensions/reference/manifest/key).

If you want your own stable ID rather than using the one in this repo, you can generate a new key pair and replace the value:

```bash
openssl genrsa 2048 | openssl rsa -pubout -outform DER | openssl base64 -A
```

Paste the output as the `"key"` value in `manifest.json`. Your extension will get a different ID from this repo's, but sync will still work across your own devices.

---

## Setup

### 1. Create colour groups

Click the extension icon in your toolbar to open the popup.

Under **Colour Groups**, click **+ Add group**. Give it a name (e.g. `Austria`) and pick a colour using the colour picker or one of the quick-select swatches.

You can create as many groups as you need.

### 2. Assign filters to groups

The **Filter Assignments** section lists all your FR24 filters. Use the dropdown next to each filter to assign it to a colour group.

Filter changes (adding, removing, or editing registrations and airport codes) are picked up automatically without reloading the page. If something looks out of sync, click **↺ Refresh Filters** at the top of the popup to force a re-read.

Aircraft matching that filter will appear on the map with a dot in the assigned colour.

> Filters must be set up in FR24 first. The extension reads them directly from the page, no manual entry needed.

### 3. Airport dots

Any FR24 filter that uses **Airport** conditions (destination or origin) will automatically have those airports marked on the map with a dot.

The dot colour is determined by finding a **colour group whose name matches the airport's country** (as FR24 reports it). The airport codes themselves can live in any filter, it's purely the colour group name that controls the colour.

For example: a colour group named `Austria` (set to pink) will cause all Austrian airports from any of your filters to appear as pink dots.

By default only airports with a matching colour group are shown. The **Airport Dots** section in the popup has two settings:

- **Show all airport dots**: when ticked, airports with no matching colour group are also shown using the default colour
- **Default colour**: the colour used for unmatched airports when the above option is enabled (defaults to red)

---

## Notes

- The extension only **reads** data from FR24, it makes no requests to FR24's servers and has no effect on your account
- Disabling a filter in FR24 will hide its aircraft dots and airport dots automatically
- Deleting and recreating a filter in FR24 will assign it a new ID, you'll need to reassign it to a colour group in the popup. Renaming a filter is fine
- If dots aren't showing after installing on a new device, try fully quitting and restarting Chrome
- The **On/Off** button at the top of the popup lets you pause the extension without uninstalling it. See the performance note below

---

## Performance

The extension processes every aircraft position update from FR24. Under normal use this is fine, but FR24's **show all aircraft** mode (the funnel icon button) can put thousands of aircraft on screen at once and cause the page to lag or freeze while the extension works through them.

> **Warning:** turn the extension **Off** using the button in the popup before enabling FR24's show-all mode. FR24 does not expose this state in a way the extension can detect, so it cannot pause itself automatically. Turn it back **On** once you are done.

---

## Skycards use case

This extension was built with the [FR24 Skycards](https://www.flightradar24.com/skycards) game in mind. A typical setup:

- One colour group per country still needed
- Country filters contain the aircraft registrations known to serve airports you need
- Continent-wide filters (e.g. `Europe - A:G`) contain the airport codes for airports still to unlock
- The map then shows both which aircraft are relevant **and** which airports to watch for

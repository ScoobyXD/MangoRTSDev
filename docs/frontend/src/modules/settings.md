# Settings Module

## Company Scope

- Dev admins can search companies by company name or UUID from Settings.
- The active company scope is persisted through `mangorts:active-company-id-v1` in session storage.
- Selecting a company scope must update the Settings Company Users list and the app scope used after returning to MangoRTS.
- Company search must stay bounded. Use `/v1/companies?query=<text>&limit=<n>` for dev-admin lookup instead of loading an unbounded company list.

## Dropdown Convention

- Settings must not use native `<select>` dropdowns.
- Settings dropdowns must use the MangoRTS custom dropdown pattern: Mango orange frame/accent, glass/dark surface where appropriate, searchable input when the option set is large, and a checkmark on the selected option.
- Role selection in Settings uses the same custom dropdown pattern even though it is a small fixed list.
- Settings must keep the shared rounded Mango taskbar header. Header tabs must navigate out of Settings to their target app pages.
- Settings surfaces, active-scope panels, and success panels must use Mango orange or neutral borders, not teal/green frames.

## Invite Flow

- Dev admins can choose the invite target company independently from the active scope.
- Company admins invite only inside their selected company scope.
- Accepting an invitation sends the signup confirmation email through the configured auth email sender. The email text must confirm successful signup with the company name.

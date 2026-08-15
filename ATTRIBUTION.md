# Attribution

PostSider builds on open-source work. This file lists the upstream projects
from which PostSider derives code, together with their licenses, in compliance
with those licenses (Requirement 10.2 of the rebrand spec).

## Upstream source

### Postiz (`postiz-app`)

- **Project:** Postiz — open-source social media scheduling tool
- **Former name / repository:** `gitroomhq/postiz-app`
- **Copyright:** Nevo David and the Postiz contributors
- **License:** GNU Affero General Public License v3.0 (AGPL-3.0)

PostSider is a fork of `postiz-app`. The original copyright notices are
preserved in [`LICENSE`](./LICENSE). PostSider's modifications — including the
rebrand and the AI Agent Bridge surface (MCP server, public REST API, SDK) —
are distributed under the same AGPL-3.0 license.

## License obligations

Because PostSider is licensed under AGPL-3.0:

- You may use, modify, and distribute it freely.
- If you run a modified version as a network service, you must make the
  corresponding source code available to the users of that service.

See [`LICENSE`](./LICENSE) for the full license text.

## Third-party dependencies

Runtime and build dependencies are listed in the various `package.json` files
across the monorepo and are governed by their respective licenses, retrieved
through the package manager. This file covers source-level derivation only.

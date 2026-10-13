# Felicity Solar (fSolar) OpenAPI

A readable copy of the vendor's API documentation, plus a review of it. The original is an Apipost share that only renders in a browser: <https://docs.apipost.net/docs/detail/533ebd61e043000>.

| File | Contents |
|---|---|
| [REVIEW.md](REVIEW.md) | Problems found in the docs, open questions for the vendor, and an integration checklist. **Start here.** |
| [REFERENCE.md](REFERENCE.md) | All 30 pages of the share (endpoints, parameters, examples, device attachments) as Markdown, reproduced as published. |
| [tools/build-reference.js](tools/build-reference.js) | Regenerates `REFERENCE.md` from the share's JSON. |

## Endpoints at a glance

Base URL: `https://open-api.felicitysolar.com`. All endpoints except login and refresh require the `Authorization` header.

| Area | Method | Path |
|---|---|---|
| Auth | POST | `/openApi/sec/login` |
| Auth | POST | `/openApi/sec/refreshToken` |
| Auth | GET | `/openApi/sec/userInfo` |
| Plants | GET | `/openApi/plants/list` |
| Plants | GET | `/openApi/data/plantPowerData/{plantId}` |
| Plants | GET | `/openApi/data/plantDataEnergy` |
| Devices | GET | `/openApi/devices/list` |
| Devices | POST | `/openApi/devices/reg` |
| Devices | POST | `/openApi/devices/del` |
| Device data | GET | `/openApi/data/deviceDataBasic/{deviceSn}` |
| Device data | GET | `/openApi/data/deviceDataEnergy` |
| Device data | GET | `/openApi/data/deviceDataHistory/{deviceSn}` |
| Device data | GET | `/openApi/data/devicesDataHistory` |
| Device data | GET | `/openApi/data/deviceDataWarn/{deviceSn}` |
| Remote control | GET | `/openApi/cmd/deviceSetting/params` |
| Remote control | GET | `/openApi/cmd/deviceSetting/{deviceSn}` |
| Remote control | POST | `/openApi/cmd/deviceSetting` |

## Refreshing the copy

The share is public. Its content comes from two unauthenticated endpoints:

```sh
curl -sS 'https://docs.apipost.net/doc/preview?issue_id=533ebd61e043000' -o preview.json
node -e 'const d=require("./preview.json").data;console.log(JSON.stringify({issue_id:d.issue_id,target_ids:d.list.map(x=>x.target_id)}))' > ids.json
curl -sS -X POST 'https://docs.apipost.net/doc/details' -H 'Content-Type: application/json' --data @ids.json -o details.json
node tools/build-reference.js preview.json details.json REFERENCE.md
```

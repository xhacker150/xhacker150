# fSolar OpenAPI — Documentation Review

Reviewed: the Apipost share <https://docs.apipost.net/docs/detail/533ebd61e043000> (project "openApi", last updated 2026-04-17; individual endpoints edited up to 2026-09-21).
Full content: [REFERENCE.md](REFERENCE.md).

Everything here comes from reading the documentation. I made no authenticated calls to the live API, so wherever the docs contradict themselves, the actual server behaviour is still **unverified**. Each such case is listed under "Questions for Felicity Solar".

Severity: **High** means an integration built from the docs alone will probably break or behave unsafely. **Medium** means it will cost debugging time. **Low** covers cosmetic problems.

---

## 1. Authentication and security

| # | Severity | Finding |
|---|---|---|
| 1.1 | High | **The login RSA key is 512-bit.** The published public key (`MFwwDQYJKoZI…`) is RSA-512, which can be factored cheaply today. The "encrypted password" therefore gives essentially no protection beyond TLS. Anyone who captures a login body can treat it as the plaintext password, and replaying it works because PKCS#1 v1.5 has no nonce. Credentials must only be sent over HTTPS. Ask the vendor to move to ≥2048-bit RSA with OAEP. |
| 1.2 | Medium | **The padding scheme is not stated.** The Java sample uses `Cipher.getInstance("RSA")`, which in the JDK defaults to `RSA/ECB/PKCS1Padding`. Clients in other languages must use **PKCS#1 v1.5**, not OAEP. The docs never say this. |
| 1.3 | Medium | **Token format is unusual and undocumented.** `token` is returned as `Bearer_<jwt>` (with an underscore), and every example sends it verbatim: `Authorization: Bearer_eyJ…`. The docs never say whether you should add a `Bearer ` prefix. Send the value exactly as returned. |
| 1.4 | Medium | **Token lifetimes are not documented.** From the sample JWT, the access token lasts 30 days (`exp − iat` = 2 592 000 s) and the refresh token about 60 days. Expiry is reported as `code: 998` in an HTTP 200 body, and "log in again" as `code: 999`. Your client has to detect both. |
| 1.5 | Low | It is unclear whether `POST /openApi/sec/refreshToken` needs an `Authorization` header. No header is documented, but the shared auth setting is "inherit" with no global auth defined. |
| 1.6 | Low | The share defines **no global auth**, so the "Try it" panel in Apipost never sends a token. Every endpoint lists `Authorization` by hand, with inconsistent types (`string` / `Text`) and inconsistent "required" flags on `Lang`. |

## 2. Environments and transport

| # | Severity | Finding |
|---|---|---|
| 2.1 | High | **The production base URL appears only in prose** (the "Public Infomation" page: `https://open-api.felicitysolar.com`). The only configured environment is the Apipost **mock** (`https://mock.apipost.net/mock/533ea02c9443000`). No sandbox environment is documented. |
| 2.2 | High | **GET requests are documented with request bodies.** `deviceDataEnergy`, `plantDataEnergy`, `plants/list`, `devices/list`, `deviceDataWarn/{sn}` and `cmd/deviceSetting/{sn}` take their parameters as `form-data` **bodies on GET**. Many HTTP clients, proxies and CDNs drop GET bodies. `deviceDataHistory/{sn}` lists the same parameters in *both* the query string and the body. Find out (or test) whether the query string works. |
| 2.3 | Medium | **Errors use HTTP 200.** The "Fail" examples are labelled 201/404 in Apipost, but the bodies, and the remote-control examples ("token expired (200)", "Permission Denied (200)"), show that failures come back as **HTTP 200 with a non-200 `code`**. Always check `body.code === 200`. |
| 2.4 | Medium | **There is no central error-code list.** The "Response Codes" page is empty. These codes are scattered across endpoints: `998` token expired, `999` log in again, `1002001` account not activated, `1002006` wrong password, `1006001` device already exists, `1006002` device does not exist, `1006051` failed to send command, `2001528` insufficient permissions. |
| 2.5 | Low | Headers such as `Content-Type: application/x-www-form-urlencoded` are marked **required on GET** requests that have no body. |
| 2.6 | Low | **Rate limits, quotas and retry guidance are not documented.** |

## 3. Data types and identifiers

| # | Severity | Finding |
|---|---|---|
| 3.1 | High | **Some IDs exceed the safe-integer range in JS and JSON.** Example `plantId` `"1514942003705499649"` and the command `id` `"9797479076789696"` are both above 2^53. The docs type `plantId` as `number` in requests and the command `id` as `integer`. Keep every ID as a **string** end-to-end, or JavaScript/JSON parsers will corrupt them silently. |
| 3.2 | Medium | Pagination fields are typed `string` (`"total": "6"`, `"pageSize": "10"`) in some endpoints and `number` in others. |
| 3.3 | Medium | **Timezones are ambiguous.** `timeStamp` is "converted based on UTC+8", while plants carry their own `timeZone` (for example `UTC+03:00`) and history rows carry a `timeZone`. The docs never say which zone the request parameters `dateStr`/`startTime`/`endTime` are read in. |
| 3.4 | Low | Date formats are inconsistent: `yyyy-MM-dd HH:mm:ss` in most places, but `yyyy MM dd HH: mm: ss` on `deviceDataHistory`. |

## 4. Per-endpoint problems

### User-related
- `GET /openApi/sec/userInfo`: status is **"In Progress"**. The example is lorem-ipsum ("cupidatat ex labore"), there is no field table, and the 401 example is empty.

### Device Data
- `deviceDataEnergy` and `plantDataEnergy`:
  - `data.records` is typed `object` but is an **array**.
  - `data.total` is described as "Total page", but the example (`total: 110`, `size: 10`, `pages: 11`) shows it is the **total record count**.
  - The responses leak MyBatis-Plus internals (`orders`, `optimizeCountSql`, `hitCount`, `searchCount`).
  - `pageNum`/`pageSize` are "required" even for `timeDimension=total`.
  - The field is spelled `bat2ChartEnergy` while the matching discharge field is `batDis2Energy`. Use the names exactly as documented.
- `plantDataEnergy`:
  - `startTime`/`endTime` are marked **required**, yet the text says they are mutually exclusive with `dateStr`.
  - The `plantId` example (`020505004822242582`) is actually a device serial number.
- `deviceDataHistory/{sn}` and `devicesDataHistory` (single and batch history):
  - **There is no real response example.** The example field contains stray text: *"Could you provide the link or specify what you're referring to: https://doc.apipost.net/…"*.
  - The field table lists `total` and `dataList.*` without the `data.` prefix, so the nesting is unknown.
  - The detailed field reference links to a **different Apipost project** (`doc.apipost.net/…/2c65f6449c64000`, "flsOpenApi") instead of the attachment pages in this share.
  - Batch: up to 50 serial numbers. `queryType=1` pages within a half-hour window.
- `deviceDataWarn/{sn}`:
  - The fields are spelled `warringName`/`warringType` (sic). This misspelling is part of the API contract, so do not "fix" it in clients.
  - The example `message` is German ("Erfolg"), which suggests `Lang` affects responses, but only `en_US` is documented.
  - The query window is limited to 7 days.

### Plant Interface
- `GET /openApi/plants/list`: **the response schema is for the wrong endpoint.** The table documents *device* fields (`deviceSn`, `masterVersion`, `bpIpaVersion`, …). The example returns plant fields (`plantId`, `plantName`, `timeZone`, `plantAddress`, `plantAuthority`), and `plantAuthority` is undocumented. The `total`/`totalPage`/`currentPage` fields in the table are missing from the example.
- `GET /openApi/data/plantPowerData/{plantId}`: status is **"In Progress"** and there is no field table. The "Fail (404)" example is actually a **success** body (`code: 200`).

### Device Interface
- `devices/list` and `devices/reg`/`devices/del` look consistent. `deviceSaveInfoList` is typed `object` but is an array. `checkCode` is the code printed on the device barcode.

### Remote Control
| Severity | Finding |
|---|---|
| High | **Partial-update semantics are undefined on a write endpoint that controls hardware.** The `POST /openApi/cmd/deviceSetting` body example sends `""` for numeric fields such as `batteryChargedVoltage`. The docs never say whether omitted or empty fields are left unchanged or reset. Send **only** the fields you intend to change, and confirm this behaviour with the vendor first. |
| High | **Grid-protection and destructive parameters are writable.** These include anti-islanding, voltage/frequency trip values, ride-through, export limits and, on IV* models, `factoryReset` and `clearEnergyStorageLog`. Changing them can break local grid-code compliance. An integration should allow-list the parameters it sends. |
| High | **There is no endpoint for command status or result.** `deviceSetting` returns a command `id`, but nothing documents how to check whether the device applied it. The only option is to re-read the values with `GET /cmd/deviceSetting/{sn}`, which is the vendor's documented behaviour. |
| Medium | `ecoRule5`–`ecoRule10` are marked **required** while `ecoRule1`–`4` are optional, which is almost certainly wrong. |
| Medium | Time formats are wrong. `startTime`/`stopTime` are documented as `HH:ss` (they should be `HH:mm`). `startDay`/`stopDay` are documented as `mm:dd`, where `mm` normally means minutes. The examples (`14:20`, `01:01`) suggest `HH:mm` and `MM:dd`. |
| Medium | The `ecoRule4.voltage` example (`35`) is outside the stated 48–60 V range. |
| Medium | `GET /cmd/deviceSetting/{deviceSn}` takes `deviceSn` in the path **and** in a form body on a GET. |
| Low | `GET /cmd/deviceSetting/params` is "In Progress". Its response uses the misspelled key `rang`, and its 404 example is empty. |
| Low | Typos that are part of the API (keep them as-is): `fixQPencent`, `fpRestoreFrequencyUperLimit`. |
| Low | The "more devices" links point to the other project (`2c65f6449c64000`), although equivalent attachment pages exist in this share. |

## 5. Documentation hygiene (Low)
- Three endpoints are still marked "In Progress": `userInfo`, `plantPowerData`, `deviceSetting/params`.
- Some example labels are left in Chinese (成功/失败/授权失败, 设备SN).
- "Public Infomation" is misspelled. The heading levels in the attachment pages are inconsistent.
- Many response tables have every field "required: no", or have no table at all, only examples.
- Mixed product names: "fSolar", "Fsolar" and "FelicitySolar" all appear.

---

## Questions for Felicity Solar

1. Can GET parameters be sent in the query string instead of a form body, for every GET endpoint?
2. Is there a sandbox environment, and are there documented rate limits?
3. On `POST /cmd/deviceSetting`, are omitted or empty fields left unchanged? How do we get the result of command `id`?
4. Which timezone are `dateStr`, `startTime` and `endTime` read in: UTC+8, the plant's zone, or UTC?
5. What is the real response shape of `plants/list`, `deviceDataHistory` and `devicesDataHistory`?
6. Is there a full error-code list?
7. Is there a plan to replace the RSA-512 login key?

## Integration checklist (until the above are answered)
- Base URL `https://open-api.felicitysolar.com`. HTTPS only.
- Log in with the password RSA-encrypted using **PKCS#1 v1.5**, base64-encoded. Store `token` and `refreshToken` verbatim, including the `Bearer_` prefix.
- Send `Authorization: <token as returned>` and `Lang: en_US` on every call.
- Treat any `body.code !== 200` as an error, regardless of HTTP status. On `998`, refresh the token. On `999`, log in again.
- Keep all IDs and serial numbers as strings.
- Page sizes: at most 300. Batch history: at most 50 serial numbers.
- Remote control: send only an allow-listed set of fields, then read the values back to verify.

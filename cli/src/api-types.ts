/**
 * Named aliases over the types generated from api/openapi.json.
 *
 * Everything the CLI reads from the API is typed here and nowhere else; a
 * hand-written response interface would be a second contract that can drift
 * from the Worker. Regenerate with `bun run generate`.
 */

import type { components, paths } from "./generated/api";

type Schemas = components["schemas"];
/** The JSON body of a route's 200 response, for the routes whose schema is inline rather than a named component. */
type JsonOf<P extends keyof paths> = paths[P] extends { get: { responses: { 200: { content: { "application/json": infer T } } } } } ? T : never;

export type ApiMeta = Schemas["Meta"];
export type ApiVersions = Schemas["Versions"];
export type ApiClass = Schemas["Class"];
export type ApiProperty = Schemas["Property"];
/** The `ft`/`kt`/`vt`/`kh` fields every typed thing carries (a property, a history entry, a change). */
export type ApiTypeFields = Schemas["ChangeTuple"];
export type ApiDescendantNode = Schemas["DescendantNode"];
export type ApiHashIndex = Schemas["HashIndex"];
export type ApiNameList = Schemas["NameList"];
export type ApiChangelogIndex = Schemas["ChangelogIndex"];
export type ApiChangelogPatch = Schemas["ChangelogPatch"];
export type ApiClassChange = Schemas["ClassChange"];
export type ApiPropChange = Schemas["PropChange"];
export type ApiClassDocs = Schemas["ClassDocs"];
export type ApiDocEntry = Schemas["DocEntry"];
export type ApiError = Schemas["Error"];
/** `/v1/index`: API class name -> absolute wiki page URL. */
export type ApiWikiIndex = JsonOf<"/v1/index">;
/** `/v1/docs/all`: class name -> its prose. */
export type ApiAllDocs = JsonOf<"/v1/docs/all">;

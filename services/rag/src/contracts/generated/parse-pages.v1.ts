/* eslint-disable */
/**
 * GENERATED from contracts/parse-pages.v1.schema.json by scripts/generate-contract-types.mjs.
 * Do not edit by hand; edit the schema and run `npm run contracts:generate`.
 */

/**
 * Queue `parse.pages` (producer: rag worker, consumer: document-parser). Parses one batch of pages into normalised blocks written as JSON Lines (see block-manifest-record.v1). The job's return value is `ParsePagesResult`. Jobs are children of an `ingest.assemble` flow parent.
 */
export interface ParsePagesContract {
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ParsePagesContract`'s JSON-Schema
 * via the `definition` "ObjectReference".
 */
export interface ObjectReference {
  bucket: string;
  key: string;
}
/**
 * This interface was referenced by `ParsePagesContract`'s JSON-Schema
 * via the `definition` "PagePlan".
 */
export interface PagePlan {
  pageNumber: number;
  pageKind: 'digital' | 'scanned' | 'hybrid';
  /**
   * Gateway tasks the parser may call for this page. `document_parse` parses the whole page; empty means native extraction only.
   */
  useVisionModelFor: ('document_parse' | 'table_extraction' | 'equation_ocr' | 'chart_description')[];
}
/**
 * This interface was referenced by `ParsePagesContract`'s JSON-Schema
 * via the `definition` "ParsePagesPayload".
 */
export interface ParsePagesPayload {
  documentId: string;
  ingestionRunId: string;
  batchNumber: number;
  parseSource: ObjectReference;
  /**
   * @minItems 1
   * @maxItems 64
   */
  pages: [PagePlan, ...PagePlan[]];
  outputPrefix: string;
  limits: ParsePagesLimits;
}
export interface ParsePagesLimits {
  /**
   * Budget for this batch.
   */
  maxVisionModelCalls: number;
  /**
   * Upper bound for one page, including the vision-model call (Nemotron Parse on CPU takes 15-60 s per page).
   */
  pageTimeoutSeconds: number;
  renderDpi: number;
}
/**
 * This interface was referenced by `ParsePagesContract`'s JSON-Schema
 * via the `definition` "ParsedPageSummary".
 */
export interface ParsedPageSummary {
  pageNumber: number;
  /**
   * How the page's blocks were produced: `native` text layer, the vision model (`vlm`, or `native+vlm` when only some regions went to it), or `ocr_tesseract` as a fallback.
   */
  parseMethod: 'native' | 'native+vlm' | 'vlm' | 'ocr_tesseract';
  ocrQualityScore: number | null;
  /**
   * Object key of the rendered page image, if one was made.
   */
  renderKey: string | null;
  blockCount: number;
}
/**
 * Job return value. `manifest` is a JSON Lines file of BlockManifestRecord under outputPrefix.
 *
 * This interface was referenced by `ParsePagesContract`'s JSON-Schema
 * via the `definition` "ParsePagesResult".
 */
export interface ParsePagesResult {
  documentId: string;
  ingestionRunId: string;
  batchNumber: number;
  manifest: ObjectReference;
  pages: ParsedPageSummary[];
  visionModelCallCount: number;
}

/** The JSON Schema itself, for runtime validation with Ajv. */
export const PARSE_PAGES_V1_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://universal-chatbot.local/contracts/parse-pages.v1.schema.json",
  "title": "ParsePagesContract",
  "description": "Queue `parse.pages` (producer: rag worker, consumer: document-parser). Parses one batch of pages into normalised blocks written as JSON Lines (see block-manifest-record.v1). The job's return value is `ParsePagesResult`. Jobs are children of an `ingest.assemble` flow parent.",
  "$defs": {
    "ObjectReference": {
      "title": "ObjectReference",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "bucket",
        "key"
      ],
      "properties": {
        "bucket": {
          "type": "string",
          "minLength": 3,
          "maxLength": 63
        },
        "key": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        }
      }
    },
    "PagePlan": {
      "title": "PagePlan",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "pageNumber",
        "pageKind",
        "useVisionModelFor"
      ],
      "properties": {
        "pageNumber": {
          "type": "integer",
          "minimum": 1
        },
        "pageKind": {
          "enum": [
            "digital",
            "scanned",
            "hybrid"
          ]
        },
        "useVisionModelFor": {
          "type": "array",
          "uniqueItems": true,
          "description": "Gateway tasks the parser may call for this page. `document_parse` parses the whole page; empty means native extraction only.",
          "items": {
            "enum": [
              "document_parse",
              "table_extraction",
              "equation_ocr",
              "chart_description"
            ]
          }
        }
      }
    },
    "ParsePagesPayload": {
      "title": "ParsePagesPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "documentId",
        "ingestionRunId",
        "batchNumber",
        "parseSource",
        "pages",
        "outputPrefix",
        "limits"
      ],
      "properties": {
        "documentId": {
          "type": "string",
          "format": "uuid"
        },
        "ingestionRunId": {
          "type": "string",
          "format": "uuid"
        },
        "batchNumber": {
          "type": "integer",
          "minimum": 1
        },
        "parseSource": {
          "$ref": "#/$defs/ObjectReference"
        },
        "pages": {
          "type": "array",
          "minItems": 1,
          "maxItems": 64,
          "items": {
            "$ref": "#/$defs/PagePlan"
          }
        },
        "outputPrefix": {
          "type": "string",
          "pattern": "^documents/[0-9a-f-]{36}/runs/[0-9a-f-]{36}/$"
        },
        "limits": {
          "title": "ParsePagesLimits",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "maxVisionModelCalls",
            "pageTimeoutSeconds",
            "renderDpi"
          ],
          "properties": {
            "maxVisionModelCalls": {
              "type": "integer",
              "minimum": 0,
              "description": "Budget for this batch."
            },
            "pageTimeoutSeconds": {
              "type": "integer",
              "minimum": 1,
              "maximum": 3600,
              "description": "Upper bound for one page, including the vision-model call (Nemotron Parse on CPU takes 15-60 s per page)."
            },
            "renderDpi": {
              "type": "integer",
              "minimum": 72,
              "maximum": 400
            }
          }
        }
      }
    },
    "ParsedPageSummary": {
      "title": "ParsedPageSummary",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "pageNumber",
        "parseMethod",
        "ocrQualityScore",
        "renderKey",
        "blockCount"
      ],
      "properties": {
        "pageNumber": {
          "type": "integer",
          "minimum": 1
        },
        "parseMethod": {
          "enum": [
            "native",
            "native+vlm",
            "vlm",
            "ocr_tesseract"
          ],
          "description": "How the page's blocks were produced: `native` text layer, the vision model (`vlm`, or `native+vlm` when only some regions went to it), or `ocr_tesseract` as a fallback."
        },
        "ocrQualityScore": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0,
          "maximum": 1
        },
        "renderKey": {
          "type": [
            "string",
            "null"
          ],
          "description": "Object key of the rendered page image, if one was made."
        },
        "blockCount": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "ParsePagesResult": {
      "title": "ParsePagesResult",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "documentId",
        "ingestionRunId",
        "batchNumber",
        "manifest",
        "pages",
        "visionModelCallCount"
      ],
      "properties": {
        "documentId": {
          "type": "string",
          "format": "uuid"
        },
        "ingestionRunId": {
          "type": "string",
          "format": "uuid"
        },
        "batchNumber": {
          "type": "integer",
          "minimum": 1
        },
        "manifest": {
          "$ref": "#/$defs/ObjectReference"
        },
        "pages": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ParsedPageSummary"
          }
        },
        "visionModelCallCount": {
          "type": "integer",
          "minimum": 0
        }
      },
      "description": "Job return value. `manifest` is a JSON Lines file of BlockManifestRecord under outputPrefix."
    }
  },
  "examples": [
    {
      "payload": {
        "documentId": "0f8fad5b-d9cb-469f-a165-70867728950e",
        "ingestionRunId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "batchNumber": 1,
        "parseSource": {
          "bucket": "rag",
          "key": "originals/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        },
        "pages": [
          {
            "pageNumber": 1,
            "pageKind": "digital",
            "useVisionModelFor": [
              "table_extraction"
            ]
          },
          {
            "pageNumber": 2,
            "pageKind": "scanned",
            "useVisionModelFor": [
              "document_parse"
            ]
          }
        ],
        "outputPrefix": "documents/0f8fad5b-d9cb-469f-a165-70867728950e/runs/7c9e6679-7425-40de-944b-e07fc1f90ae7/",
        "limits": {
          "maxVisionModelCalls": 8,
          "pageTimeoutSeconds": 900,
          "renderDpi": 144
        }
      },
      "result": {
        "documentId": "0f8fad5b-d9cb-469f-a165-70867728950e",
        "ingestionRunId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "batchNumber": 1,
        "manifest": {
          "bucket": "rag",
          "key": "documents/0f8fad5b-d9cb-469f-a165-70867728950e/runs/7c9e6679-7425-40de-944b-e07fc1f90ae7/blocks-0001.jsonl"
        },
        "pages": [
          {
            "pageNumber": 1,
            "parseMethod": "native+vlm",
            "ocrQualityScore": null,
            "renderKey": null,
            "blockCount": 14
          },
          {
            "pageNumber": 2,
            "parseMethod": "vlm",
            "ocrQualityScore": null,
            "renderKey": "documents/0f8fad5b-d9cb-469f-a165-70867728950e/runs/7c9e6679-7425-40de-944b-e07fc1f90ae7/pages/2.png",
            "blockCount": 9
          }
        ],
        "visionModelCallCount": 1
      }
    }
  ]
} as const;

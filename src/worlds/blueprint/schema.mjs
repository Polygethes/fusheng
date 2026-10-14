// World blueprint JSON Schema (specification §5)
export const BLUEPRINT_VERSION = 1;

const ID_PATTERN = "^[a-z0-9][a-z0-9_-]{0,47}$";
const HEX_COLOR = "^#[0-9a-fA-F]{6}$";
const CLOCK_PATTERN = "^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$";

const textMeta = { type: "string", maxLength: 400 };
const nameMeta = { type: "string", maxLength: 24 };
const dialogueMeta = { type: "string", maxLength: 80 };
const memoryMeta = { type: "string", maxLength: 300 };

export const WORLD_SECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["blueprintVersion", "meta", "town"],
  properties: {
    blueprintVersion: { type: "integer", const: 1 },
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["id", "title", "premise", "genre", "tone", "language", "startDay", "startClock", "startLabel", "seed"],
      properties: {
        id: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
        title: nameMeta,
        premise: textMeta,
        genre: nameMeta,
        tone: nameMeta,
        language: { type: "string", maxLength: 16 },
        startDay: { type: "string", maxLength: 32 },
        startClock: { type: "string", pattern: CLOCK_PATTERN },
        startLabel: { type: "string", maxLength: 32 },
        seed: { type: "integer" },
      },
    },
    town: {
      type: "object",
      additionalProperties: false,
      required: ["name", "terrain", "sites"],
      properties: {
        name: nameMeta,
        terrain: {
          type: "object",
          additionalProperties: false,
          required: ["river", "forest", "hills", "fields"],
          properties: {
            river: { anyOf: [{ type: "string", maxLength: 32 }, { type: "null" }] },
            forest: { anyOf: [{ type: "string", maxLength: 32 }, { type: "null" }] },
            hills: { anyOf: [{ type: "string", maxLength: 32 }, { type: "null" }] },
            fields: { anyOf: [{ type: "string", maxLength: 32 }, { type: "null" }] },
          },
        },
        sites: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "type"],
            properties: {
              id: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
              name: nameMeta,
              type: { type: "string", maxLength: 32 },
              householdId: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
              attachedHome: { type: "boolean" },
            },
          },
        },
      },
    },
  },
};

export const SITES_SECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["households"],
  properties: {
    households: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "siteId"],
        properties: {
          id: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
          name: nameMeta,
          siteId: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
        },
      },
    },
  },
};

const RESIDENT_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "name", "age", "role", "householdId", "workSiteId",
    "appearance", "personality", "skills", "speech", "situation",
    "desires", "principles", "boundaries", "routine", "memories", "secrets",
  ],
  properties: {
    id: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
    name: nameMeta,
    age: { type: "integer", minimum: 1, maximum: 120 },
    role: { type: "string", maxLength: 80 },
    newcomer: { type: "boolean" },
    look: { type: "string", maxLength: 60 },
    sex: { type: "string", enum: ["female", "male"] },
    pregnancyWeeks: { type: "integer", minimum: 1, maximum: 42 },
    householdId: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
    workSiteId: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
    appearance: {
      type: "object",
      additionalProperties: false,
      required: ["skin", "hair", "robe", "sash", "styles", "child"],
      properties: {
        skin: { type: "string", pattern: HEX_COLOR },
        hair: { type: "string", pattern: HEX_COLOR },
        robe: { type: "string", pattern: HEX_COLOR },
        sash: { type: "string", pattern: HEX_COLOR },
        styles: { type: "array", items: { type: "string", maxLength: 24 } },
        child: { type: "boolean" },
      },
    },
    personality: {
      type: "object",
      additionalProperties: false,
      required: ["autonomy", "introversion", "persistence", "conscientiousness", "competitiveness", "care", "caution", "impulsivity"],
      properties: {
        autonomy: { type: "number", minimum: 0, maximum: 1 },
        introversion: { type: "number", minimum: 0, maximum: 1 },
        persistence: { type: "number", minimum: 0, maximum: 1 },
        conscientiousness: { type: "number", minimum: 0, maximum: 1 },
        competitiveness: { type: "number", minimum: 0, maximum: 1 },
        care: { type: "number", minimum: 0, maximum: 1 },
        caution: { type: "number", minimum: 0, maximum: 1 },
        impulsivity: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    skills: { type: "array", maxItems: 10, items: { type: "string", maxLength: 24 } },
    speech: {
      type: "object",
      additionalProperties: false,
      required: ["style", "samples"],
      properties: {
        style: textMeta,
        samples: { type: "array", maxItems: 12, items: dialogueMeta },
      },
    },
    situation: textMeta,
    desires: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["verb", "object", "outcome", "strength"],
        properties: {
          verb: { type: "string", maxLength: 24 },
          object: { type: "string", maxLength: 80 },
          outcome: { type: "string", maxLength: 200 },
          strength: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    principles: { type: "array", maxItems: 8, items: { type: "string", maxLength: 100 } },
    boundaries: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["protects", "trigger", "response"],
        properties: {
          protects: { type: "string", maxLength: 80 },
          trigger: { type: "string", maxLength: 100 },
          response: { type: "string", maxLength: 100 },
        },
      },
    },
    routine: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "activity", "siteId"],
        properties: {
          from: { type: "string", pattern: CLOCK_PATTERN },
          to: { type: "string", pattern: CLOCK_PATTERN },
          activity: { type: "string", maxLength: 100 },
          siteId: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
        },
      },
    },
    memories: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["when", "content"],
        properties: {
          when: { type: "string", maxLength: 40 },
          content: memoryMeta,
        },
      },
    },
    secrets: { type: "array", maxItems: 6, items: memoryMeta },
  },
};

export const RESIDENTS_SECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["residents"],
  properties: {
    residents: {
      type: "array",
      maxItems: 30,
      items: RESIDENT_ITEM_SCHEMA,
    },
  },
};

export const RELATIONSHIPS_SECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["relationships"],
  properties: {
    relationships: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "label", "address", "feelings"],
        properties: {
          from: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
          to: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
          label: { type: "string", maxLength: 60 },
          address: { type: "array", maxItems: 6, items: { type: "string", maxLength: 20 } },
          feelings: {
            type: "object",
            additionalProperties: { type: "number", minimum: 0, maximum: 100 },
          },
          unspoken: { type: "string", maxLength: 200 },
          misreading: { type: "string", maxLength: 200 },
        },
      },
    },
  },
};

export const OPENING_SECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["opening"],
  properties: {
    opening: {
      type: "object",
      additionalProperties: false,
      required: ["situation", "positions", "objects", "deadlines", "mysteries", "events", "visitors"],
      properties: {
        situation: textMeta,
        positions: {
          type: "object",
          additionalProperties: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
        },
        objects: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "siteId", "holder", "state", "known"],
            properties: {
              name: nameMeta,
              siteId: { anyOf: [{ type: "string", pattern: ID_PATTERN, maxLength: 48 }, { type: "null" }] },
              holder: { anyOf: [{ type: "string", pattern: ID_PATTERN, maxLength: 48 }, { type: "null" }] },
              state: { type: "object" },
              known: { type: "string", enum: ["public", "hidden", "private"] },
              madeAt: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
              needed: { type: "integer", minimum: 1, maximum: 10 },
              madeWith: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
            },
          },
        },
        deadlines: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "dueClock", "responsible", "knownBy", "conditions", "consequence"],
            properties: {
              label: { type: "string", maxLength: 100 },
              dueClock: { type: "string", pattern: CLOCK_PATTERN },
              responsible: { type: "array", maxItems: 10, items: { type: "string", pattern: ID_PATTERN, maxLength: 48 } },
              knownBy: { type: "array", maxItems: 30, items: { type: "string", pattern: ID_PATTERN, maxLength: 48 } },
              conditions: {
                type: "array",
                maxItems: 6,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["kind"],
                  properties: {
                    kind: { type: "string", enum: ["object_ready", "object_holder", "actor_at"] },
                    object: { type: "string", maxLength: 40 },
                    holder: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
                    actor: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
                    siteId: { type: "string", pattern: ID_PATTERN, maxLength: 48 },
                  },
                },
              },
              consequence: textMeta,
            },
          },
        },
        mysteries: { type: "array", maxItems: 8, items: { type: "string", maxLength: 200 } },
        events: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["atClock", "kind"],
            properties: {
              atClock: { type: "string", pattern: CLOCK_PATTERN },
              kind: { type: "string", maxLength: 40 },
              visitorId: { type: "string", maxLength: 48 },
            },
          },
        },
        visitors: {
          type: "array",
          maxItems: 6,
          items: RESIDENT_ITEM_SCHEMA,
        },
      },
    },
  },
};

export const SECTION_SCHEMAS = {
  world: WORLD_SECTION_SCHEMA,
  sites: SITES_SECTION_SCHEMA,
  residents: RESIDENTS_SECTION_SCHEMA,
  relationships: RELATIONSHIPS_SECTION_SCHEMA,
  opening: OPENING_SECTION_SCHEMA,
};

export const BLUEPRINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "blueprintVersion",
    "meta",
    "town",
    "households",
    "residents",
    "relationships",
    "opening",
  ],
  properties: {
    blueprintVersion: { type: "integer", const: 1 },
    meta: WORLD_SECTION_SCHEMA.properties.meta,
    town: WORLD_SECTION_SCHEMA.properties.town,
    households: SITES_SECTION_SCHEMA.properties.households,
    residents: RESIDENTS_SECTION_SCHEMA.properties.residents,
    relationships: RELATIONSHIPS_SECTION_SCHEMA.properties.relationships,
    opening: OPENING_SECTION_SCHEMA.properties.opening,
  },
};

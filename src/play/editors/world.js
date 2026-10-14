import { field, bindFields } from "./common.js";

const TERRAIN_OPTIONS = [
  { value: null, label: "无" },
  { value: "north", label: "北" },
  { value: "south", label: "南" },
  { value: "east", label: "东" },
  { value: "west", label: "西" },
];

export function render(container, ctx) {
  const bp = ctx.blueprint();
  const meta = bp.meta || {};
  const town = bp.town || {};
  const terrain = town.terrain || {};

  container.innerHTML = `
    <div class="editor-section">
      <div class="section-title">世界设定</div>
      <div class="field-grid">
        ${field({ path: "meta.title", label: "世界名", value: meta.title, maxLength: 24 })}
        ${field({ path: "meta.genre", label: "类型", value: meta.genre })}
        ${field({ path: "meta.tone", label: "基调", value: meta.tone })}
      </div>
      ${field({ path: "meta.premise", label: "前提", value: meta.premise, kind: "textarea", maxLength: 400 })}
    </div>

    <div class="editor-section">
      <div class="section-title">开场时间与小镇</div>
      <div class="field-grid">
        ${field({ path: "meta.startDay", label: "开场日子", value: meta.startDay })}
        ${field({ path: "meta.startClock", label: "开场时刻", value: meta.startClock, kind: "clock" })}
        ${field({ path: "meta.startLabel", label: "时辰说法", value: meta.startLabel })}
        ${field({ path: "town.name", label: "镇名", value: town.name })}
      </div>
      ${field({
        path: "meta.id",
        label: "世界库里的名字",
        value: meta.id,
        hint: "只能用小写字母、数字、下划线和短横线",
      })}
    </div>

    <div class="editor-section">
      <div class="section-title">小镇地形</div>
      <div class="field-grid">
        ${field({ path: "town.terrain.river", label: "河流", value: terrain.river, kind: "select", options: TERRAIN_OPTIONS })}
        ${field({ path: "town.terrain.forest", label: "树林", value: terrain.forest, kind: "select", options: TERRAIN_OPTIONS })}
        ${field({ path: "town.terrain.hills", label: "山丘", value: terrain.hills, kind: "select", options: TERRAIN_OPTIONS })}
        ${field({ path: "town.terrain.fields", label: "农田", value: terrain.fields, kind: "select", options: TERRAIN_OPTIONS })}
      </div>
    </div>

    <div class="editor-actions">
      <button type="button" class="btn btn-rewrite">让模型重写这一页</button>
    </div>
  `;

  bindFields(container, ctx);

  container.querySelector(".btn-rewrite")?.addEventListener("click", () => {
    ctx.rewrite("meta", "世界");
  });
}

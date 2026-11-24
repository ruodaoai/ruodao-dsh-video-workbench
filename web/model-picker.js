/* 若道 · 模型选择器（插件界面共用）
 *
 * 与任务栏输入框的模型菜单同款：胶囊触发按钮 + 分组弹层（自定义模型 / 云端模型）、
 * 供应商色点、选中对勾、行内副标题（直连自有供应商 / 若道余额计费 · 当前生效）、
 * 云端计费附注（按次单价或 token 倍率）。插件不得再用原生 <select> 选模型。
 *
 * 由桌面宿主/独立版外壳以 /__ruodao/model-picker.js 注入所有插件页面；
 * 插件自带的 web/model-picker.js 是同一份实现的本地副本（宿主注入版本优先）。
 *
 * 对外契约：
 *   RuodaoModelPicker.mount(container, options) -> instance
 *   instance: { root, trigger, update(next), open(), close(), destroy(), getValue() }
 *   RuodaoModelPicker.closeAll()
 *   RuodaoModelPicker.groups(models) / isCloud(entry) / titleOf(entry) / descOf(entry, activeId) / billingOf(entry)
 *
 * options:
 *   models          [{ id, model, provider, providerName, modelConfigId, group, modelOrigin,
 *                      billingMode, perCallQuota, modelRatio, isRecommended }]
 *   value           当前值（模型 id，或 leadingOptions 里的 option id；空串表示未选）
 *   activeId        本轮真正生效的模型 id（决定副标题是否写「当前生效」）
 *   leadingOptions  [{ id, title, desc }] 置顶项（如「跟随全局设置」「不使用」）
 *   label           无障碍/占位用的模型类别名（文本模型 / 图片模型 / 视频模型）
 *   placeholder     未选中时的按钮文案
 *   emptyText       没有任何可选模型时的按钮文案
 *   emptyHint       弹层内空态说明
 *   width           弹层宽度（默认 264）
 *   disabled
 *   prefix          按钮内模型名前的固定前缀（如「AI 模型」）
 *   withTone        按钮左侧是否显示供应商色点（默认 true）
 *   onChange        (value, entry | null) => void
 */
(function () {
  "use strict";
  if (window.RuodaoModelPicker) return;

  var STYLE_ID = "ruodao-model-picker-style";
  var TONES = ["blue", "green", "amber", "pink", "violet", "cyan"];
  var TONE_COLORS = { blue: "#2f6bdd", green: "#1a7f37", amber: "#e8830c", pink: "#d6409f", violet: "#7048e8", cyan: "#0b7285" };
  var GROUP_CUSTOM = "自定义模型";
  var GROUP_CLOUD = "云端模型";

  var instances = [];
  var opened = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function textOf(value) {
    return String(value == null ? "" : value).trim();
  }

  /** 供应商 → 稳定色调：同一供应商的所有模型同色，换模型不跳色。 */
  function toneOf(name) {
    var text = textOf(name).toLowerCase();
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return TONES[hash % TONES.length];
  }

  function isCloud(entry) {
    if (!entry) return false;
    if (entry.group === GROUP_CLOUD || entry.modelGroup === GROUP_CLOUD) return true;
    if (entry.group === GROUP_CUSTOM || entry.modelGroup === GROUP_CUSTOM) return false;
    if (entry.modelOrigin === "platform-cloud") return true;
    if (entry.modelOrigin === "user-managed") return false;
    return textOf(entry.provider).indexOf("ruodao-") === 0;
  }

  function titleOf(entry) {
    if (!entry) return "";
    var model = textOf(entry.model || entry.id);
    var providerName = textOf(entry.providerName || entry.name);
    if (providerName && model.indexOf(providerName + " · ") !== 0) return providerName + " · " + model;
    if (!providerName && model.indexOf("::") > 0) return model.split("::").slice(1).join("::");
    return model;
  }

  function billingOf(entry) {
    if (!entry || !isCloud(entry)) return "";
    if (entry.billingMode === "per_call") {
      var perCall = Number(entry.perCallQuota);
      return Number.isFinite(perCall) ? perCall.toLocaleString("zh-CN", { maximumFractionDigits: 4 }) + "/次" : "";
    }
    var ratio = Number(entry.modelRatio);
    return Number.isFinite(ratio) ? ratio.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + "x" : "";
  }

  function descOf(entry, activeId) {
    if (!entry) return "";
    var parts = [isCloud(entry) ? "若道余额计费" : "直连自有供应商"];
    if (activeId && entry.id === activeId) parts.push("当前生效");
    return parts.join(" · ");
  }

  /** 自定义在前、云端在后；推荐模型排在所属分组最前。 */
  function groups(models) {
    var custom = [];
    var cloud = [];
    (Array.isArray(models) ? models : []).forEach(function (entry) {
      if (!entry) return;
      (isCloud(entry) ? cloud : custom).push(entry);
    });
    var recommendedFirst = function (list) {
      return list.filter(function (entry) { return entry.isRecommended; })
        .concat(list.filter(function (entry) { return !entry.isRecommended; }));
    };
    var out = [];
    if (custom.length) out.push({ group: GROUP_CUSTOM, entries: recommendedFirst(custom) });
    if (cloud.length) out.push({ group: GROUP_CLOUD, entries: recommendedFirst(cloud) });
    return out;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      /* 触发按钮：与任务栏 composer 的模型胶囊同款（26px、13px 圆角、11.5px 字） */
      ".rd-mp { position: relative; display: inline-flex; min-width: 0; max-width: 100%; }",
      ".rd-mp-trigger { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%;",
      "  height: 26px; padding: 0 9px; border: 0; border-radius: 13px; cursor: pointer;",
      "  background: color-mix(in srgb, var(--panel-2, var(--surface-2, #f5f6fb)) 78%, transparent);",
      "  color: var(--text, var(--ink, #1f2437)); font: inherit; font-size: 11.5px; font-weight: 500; text-align: left; }",
      ".rd-mp-trigger:hover { background: color-mix(in srgb, var(--text, var(--ink, #1f2437)) 8%, transparent); }",
      ".rd-mp-trigger:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent, #6366f1) 45%, transparent); outline-offset: 1px; }",
      ".rd-mp-trigger[disabled] { cursor: not-allowed; opacity: .6; }",
      ".rd-mp-trigger.is-open { background: color-mix(in srgb, var(--text, var(--ink, #1f2437)) 9%, transparent); }",
      ".rd-mp-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; display: block; }",
      ".rd-mp-prefix { flex: none; color: var(--faint, var(--muted, #9aa1b2)); font-size: 11px; }",
      ".rd-mp-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
      ".rd-mp-value.is-placeholder { color: var(--faint, var(--muted, #9aa1b2)); }",
      ".rd-mp-caret { flex: none; width: 12px; height: 12px; color: currentColor; opacity: .55; transition: transform .15s ease; }",
      ".rd-mp-trigger.is-open .rd-mp-caret { transform: rotate(180deg); }",
      /* 弹层：照抄任务栏 composer-menu-pop（1px 描边、11px 圆角、4px 内边距、分组标题） */
      ".rd-mp-pop { position: fixed; z-index: 2147483000; box-sizing: border-box; padding: 4px;",
      "  border: 1px solid var(--line, #e7e9f2); border-radius: 11px; background: var(--panel, var(--surface, #fff));",
      "  box-shadow: 0 18px 44px rgba(23, 26, 51, .18); overflow-y: auto; overscroll-behavior: contain;",
      "  animation: rd-mp-in .14s ease; }",
      "@keyframes rd-mp-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }",
      ".rd-mp-pop::-webkit-scrollbar { width: 8px; }",
      ".rd-mp-pop::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--text, var(--ink, #1f2437)) 16%, transparent); border-radius: 999px; }",
      ".rd-mp-item { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;",
      "  padding: 5px 9px; border: 0; border-radius: 7px; background: transparent; cursor: pointer;",
      "  text-align: left; font: inherit; color: var(--text, var(--ink, #1f2437)); }",
      ".rd-mp-item:hover, .rd-mp-item.is-active, .rd-mp-item.is-current { background: color-mix(in srgb, var(--text, var(--ink, #1f2437)) 7%, transparent); }",
      ".rd-mp-icon { flex: 0 0 16px; width: 16px; display: grid; place-items: center; }",
      ".rd-mp-icon .rd-mp-dot { width: 9px; height: 9px; }",
      ".rd-mp-icon svg { width: 15px; height: 15px; }",
      ".rd-mp-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }",
      ".rd-mp-text strong { display: block; font-size: 12.5px; font-weight: 500; color: var(--text, var(--ink, #1f2437)); }",
      ".rd-mp-text small { display: block; font-size: 11px; color: var(--faint, var(--muted, #9aa1b2)); }",
      ".rd-mp-recommend { display: inline-flex; align-items: center; gap: 2px; margin-left: 6px; padding: 1px 6px;",
      "  border-radius: 999px; background: linear-gradient(135deg, #fff3d1, #ffe2b0); color: #a15c00;",
      "  font-size: 10px; font-weight: 700; line-height: 1.4; vertical-align: 1px; white-space: nowrap; }",
      ".rd-mp-trail { margin-left: auto; flex: none; font-size: 11px; color: var(--faint, var(--muted, #9aa1b2)); font-variant-numeric: tabular-nums; }",
      ".rd-mp-group { padding: 8px 12px 4px; border-top: 1px solid color-mix(in srgb, var(--muted, #6b7280) 14%, transparent);",
      "  color: var(--muted, #6b7280); font-size: 10px; font-weight: 700; letter-spacing: .08em; }",
      ".rd-mp-group:first-child { border-top: 0; padding-top: 4px; }",
      ".rd-mp-empty { margin: 0; padding: 10px 12px 12px; color: var(--faint, var(--muted, #9aa1b2)); font-size: 11.5px; line-height: 1.6; }",
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
  }

  function checkIcon(color) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2.4" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  }

  var CARET = '<svg class="rd-mp-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  function mount(container, options) {
    if (!container) return null;
    ensureStyle();
    var opts = options || {};
    var state = {
      models: Array.isArray(opts.models) ? opts.models.slice() : [],
      leadingOptions: Array.isArray(opts.leadingOptions) ? opts.leadingOptions.slice() : [],
      value: opts.value == null ? "" : String(opts.value),
      activeId: opts.activeId ? String(opts.activeId) : "",
      label: textOf(opts.label) || "模型",
      placeholder: opts.placeholder || "选择模型",
      emptyText: opts.emptyText || "",
      emptyHint: opts.emptyHint || "",
      width: Number(opts.width) || 264,
      prefix: opts.prefix || "",
      withTone: opts.withTone !== false,
      disabled: Boolean(opts.disabled),
      onChange: typeof opts.onChange === "function" ? opts.onChange : null,
    };

    var root = document.createElement("div");
    root.className = "rd-mp" + (opts.className ? " " + opts.className : "");
    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "rd-mp-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    root.appendChild(trigger);
    container.innerHTML = "";
    container.appendChild(root);

    var pop = null;
    var activeIndex = -1;
    var destroyed = false;

    function currentEntry() {
      if (!state.value) return null;
      return state.models.filter(function (entry) { return entry && entry.id === state.value; })[0] || null;
    }

    function currentLeading() {
      if (!state.leadingOptions.length) return null;
      return state.leadingOptions.filter(function (option) { return option && String(option.id || "") === state.value; })[0] || null;
    }

    function shownLabel() {
      if (!state.models.length && !state.leadingOptions.length) return state.emptyText || ("无可用" + state.label);
      var entry = currentEntry();
      if (entry) return titleOf(entry);
      var leading = currentLeading();
      if (leading) return leading.title || leading.id;
      var stored = state.value ? textOf(state.value).replace(/^custom:[^:]+:/, "") : "";
      return stored || state.placeholder;
    }

    function renderTrigger() {
      var entry = currentEntry();
      var leading = currentLeading();
      var tone = entry ? toneOf(entry.providerName || entry.provider || entry.model || entry.id) : "";
      var dot = "";
      if (state.withTone) {
        dot = entry
          ? '<span class="rd-mp-dot" style="background:' + (TONE_COLORS[tone] || "#9aa1b2") + '"></span>'
          : '<span class="rd-mp-dot" style="border:1.5px solid currentColor;opacity:.35"></span>';
      }
      trigger.disabled = state.disabled;
      trigger.title = entry ? titleOf(entry) : (leading ? (leading.desc || leading.title) : shownLabel());
      trigger.innerHTML = dot
        + (state.prefix ? '<span class="rd-mp-prefix">' + escapeHtml(state.prefix) + "</span>" : "")
        + '<span class="rd-mp-value' + (entry || leading ? "" : " is-placeholder") + '">' + escapeHtml(shownLabel()) + "</span>"
        + CARET;
    }

    function itemHtml(entry, isLeading) {
      var id = isLeading ? String(entry.id || "") : entry.id;
      var isCurrent = id === state.value;
      var tone = isLeading ? "" : toneOf(entry.providerName || entry.provider || entry.model || entry.id);
      var icon = isCurrent
        ? '<span class="rd-mp-icon">' + checkIcon(TONE_COLORS[tone] || "var(--accent, #6366f1)") + "</span>"
        : '<span class="rd-mp-icon">' + (isLeading
            ? ""
            : '<span class="rd-mp-dot" style="background:' + (TONE_COLORS[tone] || "#9aa1b2") + '"></span>') + "</span>";
      var title = isLeading ? (entry.title || entry.id || "") : titleOf(entry);
      var desc = isLeading ? textOf(entry.desc) : descOf(entry, state.activeId);
      var trail = isLeading ? "" : billingOf(entry);
      var recommend = !isLeading && entry.isRecommended
        ? '<span class="rd-mp-recommend">推荐</span>'
        : "";
      return '<button type="button" class="rd-mp-item' + (isCurrent ? " is-current" : "") + '" role="option" '
        + 'aria-selected="' + (isCurrent ? "true" : "false") + '" data-id="' + escapeHtml(id) + '" '
        + 'data-leading="' + (isLeading ? "1" : "0") + '">'
        + icon
        + '<span class="rd-mp-text"><strong>' + escapeHtml(title) + recommend + "</strong>"
        + (desc && desc !== title ? "<small>" + escapeHtml(desc) + "</small>" : "")
        + "</span>"
        + (trail ? '<span class="rd-mp-trail">' + escapeHtml(trail) + "</span>" : "")
        + "</button>";
    }

    function buildPop() {
      var html = state.leadingOptions.map(function (option) { return itemHtml(option, true); }).join("");
      groups(state.models).forEach(function (group) {
        html += '<div class="rd-mp-group" role="presentation"><span>' + escapeHtml(group.group) + "</span></div>";
        html += group.entries.map(function (entry) { return itemHtml(entry, false); }).join("");
      });
      if (!state.leadingOptions.length && !state.models.length) {
        html = '<p class="rd-mp-empty">' + escapeHtml(state.emptyHint || state.emptyText || ("还没有可用的" + state.label)) + "</p>";
      }
      return html;
    }

    function place(popNode) {
      var rect = trigger.getBoundingClientRect();
      var viewportW = window.innerWidth;
      var viewportH = window.innerHeight;
      var width = Math.min(Math.max(state.width, 200), Math.max(200, viewportW - 16));
      var spaceBelow = viewportH - rect.bottom - 10;
      var spaceAbove = rect.top - 10;
      var openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      var maxHeight = Math.max(150, Math.min(340, openUp ? spaceAbove : spaceBelow));
      var left = Math.min(Math.max(8, rect.left), Math.max(8, viewportW - width - 8));
      popNode.style.width = width + "px";
      popNode.style.maxHeight = maxHeight + "px";
      popNode.style.left = left + "px";
      if (openUp) {
        popNode.style.top = "auto";
        popNode.style.bottom = Math.max(8, viewportH - rect.top + 6) + "px";
      } else {
        popNode.style.bottom = "auto";
        popNode.style.top = rect.bottom + 6 + "px";
      }
    }

    function highlight(index) {
      if (!pop) return;
      var items = Array.prototype.slice.call(pop.querySelectorAll(".rd-mp-item"));
      if (!items.length) return;
      activeIndex = Math.max(0, Math.min(items.length - 1, index));
      items.forEach(function (node, i) { node.classList.toggle("is-active", i === activeIndex); });
      var node = items[activeIndex];
      if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
    }

    function close() {
      if (!pop) return;
      pop.parentNode && pop.parentNode.removeChild(pop);
      pop = null;
      activeIndex = -1;
      trigger.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onDocKey, true);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onScroll, true);
      if (opened === instance) opened = null;
    }

    function onDocDown(event) {
      if (!pop) return;
      if (root.contains(event.target) || pop.contains(event.target)) return;
      close();
    }

    function onDocKey(event) {
      if (!pop) return;
      if (event.key === "Escape") { event.stopPropagation(); close(); trigger.focus(); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); highlight(activeIndex + 1); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); highlight(activeIndex - 1); return; }
      if (event.key === "Enter" || event.key === " ") {
        if (activeIndex < 0) return;
        event.preventDefault();
        var node = pop.querySelectorAll(".rd-mp-item")[activeIndex];
        if (node) node.click();
      }
    }

    function onReposition() { if (pop) place(pop); }
    function onScroll(event) {
      // 滚动会让 fixed 弹层与触发按钮错位；直接收起，比追随更稳。
      if (pop && !pop.contains(event.target)) close();
    }

    function pick(id, entry, isLeading) {
      state.value = String(id || "");
      renderTrigger();
      close();
      if (state.onChange) state.onChange(state.value, isLeading ? null : entry);
    }

    function openPop() {
      if (pop || state.disabled || destroyed) return;
      if (opened && opened !== instance) opened.close();
      pop = document.createElement("div");
      pop.className = "rd-mp-pop";
      pop.setAttribute("role", "listbox");
      pop.setAttribute("aria-label", state.label);
      pop.innerHTML = buildPop();
      pop.addEventListener("click", function (event) {
        var node = event.target.closest ? event.target.closest(".rd-mp-item") : null;
        if (!node) return;
        var id = node.getAttribute("data-id") || "";
        var isLeading = node.getAttribute("data-leading") === "1";
        var entry = isLeading
          ? null
          : state.models.filter(function (item) { return item && String(item.id) === id; })[0] || null;
        pick(id, entry, isLeading);
      });
      document.body.appendChild(pop);
      place(pop);
      trigger.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      var current = pop.querySelector(".rd-mp-item.is-current");
      highlight(current ? Array.prototype.indexOf.call(pop.querySelectorAll(".rd-mp-item"), current) : 0);
      document.addEventListener("mousedown", onDocDown, true);
      document.addEventListener("keydown", onDocKey, true);
      window.addEventListener("resize", onReposition);
      window.addEventListener("scroll", onScroll, true);
      opened = instance;
    }

    function toggle() { if (pop) close(); else openPop(); }

    trigger.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    });
    trigger.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" && !pop) { event.preventDefault(); openPop(); }
    });

    var instance = {
      root: root,
      trigger: trigger,
      getValue: function () { return state.value; },
      update: function (next) {
        next = next || {};
        if ("models" in next) state.models = Array.isArray(next.models) ? next.models.slice() : [];
        if ("leadingOptions" in next) state.leadingOptions = Array.isArray(next.leadingOptions) ? next.leadingOptions.slice() : [];
        if ("value" in next) state.value = next.value == null ? "" : String(next.value);
        if ("activeId" in next) state.activeId = next.activeId ? String(next.activeId) : "";
        if ("disabled" in next) state.disabled = Boolean(next.disabled);
        if (typeof next.onChange === "function") state.onChange = next.onChange;
        if (next.placeholder) state.placeholder = next.placeholder;
        renderTrigger();
        if (pop) { close(); openPop(); }
      },
      open: openPop,
      close: close,
      destroy: function () {
        destroyed = true;
        close();
        instances = instances.filter(function (item) { return item !== instance; });
        container.innerHTML = "";
      },
    };

    renderTrigger();
    instances.push(instance);
    return instance;
  }

  window.RuodaoModelPicker = {
    version: 1,
    mount: mount,
    closeAll: function () { if (opened) opened.close(); },
    groups: groups,
    isCloud: isCloud,
    titleOf: titleOf,
    descOf: descOf,
    billingOf: billingOf,
    toneOf: toneOf,
    toneColor: function (name) { return TONE_COLORS[toneOf(name)] || "#9aa1b2"; },
  };
})();

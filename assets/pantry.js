/* Basil's Kitchen: cook with what you have.
   Loads assets/ingredients-index.json only on this page. Matching is local.
   Pantry is stored in localStorage key "basils-kitchen-pantry" and never sent. */
(function () {
  "use strict";

  var STORAGE_KEY = "basils-kitchen-pantry";
  var BASICS = ["onion", "garlic", "butter", "egg", "milk", "flour", "sugar", "rice", "olive-oil", "oil-neutral"];
  /* Client-side synonym overlay. Basil owns index data; note "hamburger" → ground-beef for the next index rebuild. */
  var EXTRA_SYNONYMS = { hamburger: "ground-beef", hamburgers: "ground-beef", "hamburger meat": "ground-beef", "hamburger mince": "ground-beef" };

  function ancestors(id, catalog) {
    var out = [], seen = {}, cur = catalog[id] && catalog[id].parent;
    while (cur && !seen[cur]) {
      seen[cur] = true;
      out.push(cur);
      cur = catalog[cur] && catalog[cur].parent;
    }
    return out;
  }

  function descendants(id, catalog) {
    var out = [], other, walk, seen, parent;
    for (other in catalog) {
      if (!Object.prototype.hasOwnProperty.call(catalog, other) || other === id) continue;
      walk = other;
      seen = {};
      while (walk && !seen[walk]) {
        seen[walk] = true;
        parent = catalog[walk] && catalog[walk].parent;
        if (parent === id && catalog[walk] && catalog[walk].downward) {
          out.push(other);
          break;
        }
        if (!parent) break;
        if (!(catalog[walk] && catalog[walk].downward)) break;
        walk = parent;
      }
    }
    return out;
  }

  function pantrySatisfies(pantry, needed, catalog) {
    if (pantry.has(needed)) return true;
    var meta = catalog[needed] || {};
    if (meta.downward && ancestors(needed, catalog).some(function (a) { return pantry.has(a); })) return true;
    return descendants(needed, catalog).some(function (d) { return pantry.has(d); });
  }

  function assumedIds(doc, assumeStaples, assumeOils) {
    var have = {}, groups = (doc.staples && doc.staples.groups) || [];
    groups.forEach(function (g) {
      var on = (g.id === "cooking-oils" || /oil/i.test(g.id)) ? assumeOils : assumeStaples;
      if (on && g.ids) g.ids.forEach(function (id) { have[id] = true; });
    });
    return have;
  }

  function idExcluded(id, exclude, catalog) {
    if (!exclude || !exclude.size) return false;
    if (exclude.has(id)) return true;
    var meta = catalog[id] || {};
    if (meta.downward && ancestors(id, catalog).some(function (a) { return exclude.has(a); })) return true;
    return false;
  }

  function recipeExcluded(recipe, exclude, catalog) {
    if (!exclude || !exclude.size) return false;
    var items = recipe.items || [];
    var i, item, ids, anyOk;
    for (i = 0; i < items.length; i++) {
      item = items[i];
      ids = item.ids || [];
      if (!ids.length) continue;
      if (item.match === "any") {
        anyOk = ids.some(function (id) { return !idExcluded(id, exclude, catalog); });
        if (!anyOk) return true;
      } else if (ids.some(function (id) { return idExcluded(id, exclude, catalog); })) {
        return true;
      }
    }
    return false;
  }

  function joinOr(labels) {
    return labels.map(function (l, i) {
      if (i === 0) return l;
      return l ? l.charAt(0).toLowerCase() + l.slice(1) : l;
    }).join(" or ");
  }

  function recipeUsesPicked(recipe, pantryId, catalog) {
    var probe = new Set([pantryId]);
    var ids = (recipe.all || []).slice();
    (recipe.items || []).forEach(function (item) {
      (item.ids || []).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
    });
    return ids.some(function (id) {
      return pantrySatisfies(probe, id, catalog) || pantrySatisfies(new Set([id]), pantryId, catalog);
    });
  }

  function scoreRecipe(recipe, pantry, catalog, assumeStaples, assumeOils, doc, exclude) {
    if (recipeExcluded(recipe, exclude, catalog)) return null;
    var assumed = assumedIds(doc, assumeStaples, assumeOils);
    var pantrySet_ = pantry instanceof Set ? pantry : new Set(pantry);
    var have = new Set(pantrySet_);
    Object.keys(assumed).forEach(function (id) { have.add(id); });
    var missing = [];
    var matched = 0;
    (recipe.items || []).forEach(function (item) {
      var ids = item.ids || [];
      if (item.optional || !ids.length) return;
      var visible = ids.filter(function (i) { return !(catalog[i] && catalog[i].hidden); });
      var hidden = ids.filter(function (i) { return catalog[i] && catalog[i].hidden; });
      var isAny = item.match === "any";
      var ok = isAny
        ? ids.some(function (i) { return pantrySatisfies(have, i, catalog); })
        : ids.every(function (i) { return pantrySatisfies(have, i, catalog); });
      if (ids.every(function (i) { return catalog[i] && catalog[i].staple && have.has(i); })) {
        if (ok) return;
      }
      if (!visible.length && hidden.length) return;
      if (ok) { matched += 1; return; }
      var labels = [];
      visible.forEach(function (i) {
        if (!pantrySatisfies(have, i, catalog)) labels.push((catalog[i] && catalog[i].label) || i);
      });
      if (!labels.length) {
        hidden.forEach(function (i) {
          var shown = null;
          ancestors(i, catalog).forEach(function (a) {
            if (shown) return;
            if (catalog[a] && !catalog[a].hidden) shown = catalog[a].label || a;
          });
          if (shown) labels.push(shown);
        });
      }
      if (item.label) missing.push(item.label);
      else if (isAny && labels.length) missing.push(joinOr(labels));
      else labels.forEach(function (l) { missing.push(l); });
    });
    var usedIds = [];
    pantrySet_.forEach(function (id) {
      if (assumed[id]) return;
      if (recipeUsesPicked(recipe, id, catalog)) usedIds.push(id);
    });
    var usedLabels = [];
    var seenLabel = {};
    function addUsedLabel(label) {
      if (!label || seenLabel[label]) return;
      seenLabel[label] = true;
      usedLabels.push(label);
    }
    var leftover = usedIds.slice();
    (recipe.items || []).forEach(function (item) {
      if (!item.label || !leftover.length) return;
      var hits = leftover.filter(function (pid) {
        return (item.ids || []).some(function (id) {
          return pantrySatisfies(new Set([pid]), id, catalog) || pantrySatisfies(new Set([id]), pid, catalog);
        });
      });
      if (!hits.length) return;
      addUsedLabel(item.label);
      leftover = leftover.filter(function (id) { return hits.indexOf(id) === -1; });
    });
    leftover.forEach(function (id) { addUsedLabel((catalog[id] && catalog[id].label) || id); });
    var mainHave = (recipe.main || []).filter(function (id) { return pantrySatisfies(have, id, catalog); }).length;
    return {
      slug: recipe.slug,
      missingCount: missing.length,
      missing: missing,
      matched: matched,
      recipe: recipe,
      usedIds: usedIds,
      usedLabels: usedLabels,
      mainHave: mainHave,
      overlap: usedIds.length
    };
  }

  function badgeFor(s) {
    if (!s) return "";
    if (s.missingCount === 0) return "You have everything";
    return "Missing " + s.missingCount + ": " + s.missing.join(", ");
  }

  function catalogById(list) {
    var c = {};
    (list || []).forEach(function (ing) { c[ing.id] = ing; });
    return c;
  }

  /* ---------------- UI ---------------- */
  var root = (typeof document !== "undefined") ? document.getElementById("pantry-root") : null;
  if (!root) {
    if (typeof module !== "undefined") {
      module.exports = { pantrySatisfies: pantrySatisfies, scoreRecipe: scoreRecipe, catalogById: catalogById, badgeFor: badgeFor, descendants: descendants, ancestors: ancestors };
    }
    return;
  }

  var state = { ids: [], assumeStaples: true, assumeOils: true, exclude: [], focus: [], missingOne: false };
  var doc = null, catalog = {}, freq = {};

  function loadStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && Array.isArray(saved.ids)) state.ids = saved.ids.slice();
      if (typeof saved.assumeStaples === "boolean") state.assumeStaples = saved.assumeStaples;
      if (typeof saved.assumeOils === "boolean") state.assumeOils = saved.assumeOils;
      if (Array.isArray(saved.exclude)) state.exclude = saved.exclude.slice();
    } catch (err) { /* storage blocked; page still works */ }
  }

  function saveStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ids: state.ids,
        assumeStaples: state.assumeStaples,
        assumeOils: state.assumeOils,
        exclude: state.exclude
      }));
    } catch (err) { /* ignore */ }
  }

  function parseList(s) {
    return (s || "").split(/[,|\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function applyUrl() {
    var params = new URLSearchParams(location.search);
    if (!params.has("have") && !params.has("no") && !params.has("staples") && !params.has("oils")) return false;
    if (params.has("have")) state.ids = parseList(params.get("have"));
    if (params.has("no")) state.exclude = parseList(params.get("no"));
    if (params.has("staples")) state.assumeStaples = params.get("staples") !== "0";
    if (params.has("oils")) state.assumeOils = params.get("oils") !== "0";
    return true;
  }

  function writeUrl(replace) {
    var params = new URLSearchParams();
    if (state.ids.length) params.set("have", state.ids.join(","));
    if (state.exclude.length) params.set("no", state.exclude.join(","));
    params.set("staples", state.assumeStaples ? "1" : "0");
    params.set("oils", state.assumeOils ? "1" : "0");
    var qs = params.toString();
    var next = location.pathname + (qs ? "?" + qs : "") + location.hash;
    if (replace) history.replaceState(null, "", next);
    return location.origin + location.pathname + (qs ? "?" + qs : "");
  }

  function indexUrl() {
    var link = document.querySelector('link[rel="preload"][data-pantry-index]');
    if (link && link.href) return link.href;
    var fallback = root.getAttribute("data-index") || "/assets/ingredients-index.json";
    try { return new URL(fallback, document.baseURI || location.href).href; } catch (e) { return fallback; }
  }

  function visibleIngredients() {
    return (doc.ingredients || []).filter(function (i) { return i.picker !== false && !i.hidden; });
  }

  function aliasMap() {
    var map = [];
    (doc.ingredients || []).forEach(function (ing) {
      var names = [ing.label, ing.id].concat(ing.aliases || []);
      names.forEach(function (n) {
        if (n) map.push({ q: String(n).toLowerCase(), id: ing.id, label: ing.label, alias: n });
      });
    });
    var syn = Object.assign({}, doc.synonyms || {}, EXTRA_SYNONYMS);
    Object.keys(syn).forEach(function (k) {
      var id = syn[k];
      var ing = catalog[id];
      map.push({ q: String(k).toLowerCase(), id: id, label: ing ? ing.label : id, alias: k });
    });
    return map;
  }

  function addId(id) {
    if (!id || !catalog[id]) return;
    if (state.ids.indexOf(id) === -1) state.ids.push(id);
    state.exclude = state.exclude.filter(function (x) { return x !== id; });
  }

  function removeId(id) {
    state.ids = state.ids.filter(function (x) { return x !== id; });
    state.focus = state.focus.filter(function (x) { return x !== id; });
  }

  function toggleId(id) {
    if (state.ids.indexOf(id) === -1) addId(id);
    else removeId(id);
  }

  function pantrySet() { return new Set(state.ids); }
  function excludeSet() { return new Set(state.exclude); }

  function recipeRequiresFocus(recipe, focusId, catalog) {
    return (recipe.items || []).some(function (item) {
      if (item.optional) return false;
      return (item.ids || []).some(function (id) {
        return pantrySatisfies(new Set([focusId]), id, catalog) || pantrySatisfies(new Set([id]), focusId, catalog);
      });
    });
  }

  function scored() {
    var pantry = pantrySet();
    var excl = excludeSet();
    var all = [];
    (doc.recipes || []).forEach(function (r) {
      var s = scoreRecipe(r, pantry, catalog, state.assumeStaples, state.assumeOils, doc, excl);
      if (s) all.push(s);
    });
    function sortRows(rows) {
      return rows.sort(function (a, b) {
        if (a.mainHave !== b.mainHave) return b.mainHave - a.mainHave;
        if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount;
        if (a.overlap !== b.overlap) return b.overlap - a.overlap;
        return a.recipe.title.localeCompare(b.recipe.title);
      });
    }
    var primary = sortRows(all.filter(function (s) { return s.overlap >= 1; }));
    var other = sortRows(all.filter(function (s) { return s.overlap < 1; }));
    if (state.focus.length) {
      primary = primary.filter(function (s) {
        return state.focus.every(function (f) { return recipeRequiresFocus(s.recipe, f, catalog); });
      });
      other = other.filter(function (s) {
        return state.focus.every(function (f) { return recipeRequiresFocus(s.recipe, f, catalog); });
      });
    }
    if (state.missingOne) {
      primary = primary.filter(function (s) { return s.missingCount === 0 || s.missingCount === 1; });
      other = [];
    }
    return { primary: primary, other: other };
  }

  function unsatisfiedIds(recipe, have) {
    var found = [];
    (recipe.items || []).forEach(function (item) {
      var ids = item.ids || [];
      if (item.optional || !ids.length) return;
      var visible = ids.filter(function (i) { return !(catalog[i] && catalog[i].hidden); });
      var hidden = ids.filter(function (i) { return catalog[i] && catalog[i].hidden; });
      var ok = item.match === "any"
        ? ids.some(function (i) { return pantrySatisfies(have, i, catalog); })
        : ids.every(function (i) { return pantrySatisfies(have, i, catalog); });
      if (ids.every(function (i) { return catalog[i] && catalog[i].staple && have.has(i); }) && ok) return;
      if (!visible.length && hidden.length) return;
      if (ok) return;
      (visible.length ? visible : []).forEach(function (i) {
        if (pantrySatisfies(have, i, catalog)) return;
        found.push(i);
        ancestors(i, catalog).forEach(function (a) {
          if (catalog[i] && catalog[i].downward && catalog[a] && !catalog[a].hidden && catalog[a].picker !== false) found.push(a);
        });
      });
    });
    return found;
  }

  function isHeldOrSuggestedParent(id, chosen, pantry) {
    if (pantry.has(id)) return true;
    var chain = [id].concat(ancestors(id, catalog));
    return chain.some(function (a) { return chosen.indexOf(a) !== -1 || pantry.has(a); });
  }

  function ifYouHad(current) {
    var assumed = assumedIds(doc, state.assumeStaples, state.assumeOils);
    var have = pantrySet();
    Object.keys(assumed).forEach(function (id) { have.add(id); });
    var byId = {};
    current.forEach(function (s) {
      if (!s || s.missingCount === 0) return;
      var ids = unsatisfiedIds(s.recipe, have);
      var seen = {};
      ids.forEach(function (id) {
        if (!id || have.has(id) || seen[id]) return;
        if (catalog[id] && (catalog[id].hidden || catalog[id].picker === false)) return;
        if (assumed[id]) return;
        seen[id] = true;
        var trial = new Set(have);
        trial.add(id);
        var next = scoreRecipe(s.recipe, trial, catalog, state.assumeStaples, state.assumeOils, doc, excludeSet());
        if (!next) return;
        var rec = byId[id] || (byId[id] = { id: id, label: (catalog[id] && catalog[id].label) || id, complete: [], almost: [] });
        if (next.missingCount === 0) rec.complete.push(s.recipe);
        else if (next.missingCount === 1 && s.missingCount > 1) rec.almost.push(s.recipe);
      });
    });
    var ideas = Object.keys(byId).map(function (id) { return byId[id]; }).filter(function (x) {
      return x.complete.length || x.almost.length;
    });
    ideas.sort(function (a, b) {
      if (a.complete.length !== b.complete.length) return b.complete.length - a.complete.length;
      if (a.almost.length !== b.almost.length) return b.almost.length - a.almost.length;
      return a.label.localeCompare(b.label);
    });
    ideas = ideas.filter(function (idea, _i, arr) {
      return !arr.some(function (other) {
        return other.id !== idea.id && ancestors(idea.id, catalog).indexOf(other.id) !== -1;
      });
    });
    var chosen = [], out = [];
    ideas.forEach(function (idea) {
      if (isHeldOrSuggestedParent(idea.id, chosen, have)) return;
      var childOfChosen = chosen.some(function (c) {
        return ancestors(idea.id, catalog).indexOf(c) !== -1;
      });
      if (childOfChosen) return;
      /* If we later add a parent, drop this child: collect first then filter — skip children of anything also in the remaining top list. */
      chosen.push(idea.id);
      var title = (idea.complete[0] || idea.almost[0] || {}).title || "a recipe";
      var more = Math.max(idea.complete.length, idea.almost.length) - 1;
      var line;
      if (idea.complete.length) {
        line = "Add " + idea.label.charAt(0).toLowerCase() + idea.label.slice(1) + " → makes " + title;
        if (more > 0) line += " and " + more + " more";
      } else {
        line = "Add " + idea.label.charAt(0).toLowerCase() + idea.label.slice(1) + " → brings " + title + " to missing 1";
        if (more > 0) line += " and " + more + " more";
      }
      idea.line = line;
      out.push(idea);
    });
    return out.slice(0, 5);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function recipeHref(url) {
    try { return new URL(url, location.href).href; } catch (e) { return url; }
  }

  function renderSelected() {
    var box = document.getElementById("pantry-selected");
    if (!box) return;
    if (!state.ids.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = state.ids.map(function (id) {
      var label = (catalog[id] && catalog[id].label) || id;
      return '<button type="button" class="chip pantry-have" data-id="' + escapeHtml(id) + '" aria-pressed="true">' + escapeHtml(label) + '<span class="sr">, remove</span></button>';
    }).join("");
  }

  function renderBasics() {
    var box = document.getElementById("kitchen-basics");
    if (!box) return;
    var chips = BASICS.map(function (id) { return catalog[id]; }).filter(function (i) { return i && i.picker !== false && !i.hidden; });
    if (!chips.length) { box.innerHTML = ""; return; }
    box.innerHTML = '<fieldset class="pantry-group pantry-basics"><legend>Kitchen basics</legend><div class="pantry-chips">' +
      chips.map(chipBtn).join("") + "</div></fieldset>";
  }

  function chipBtn(ing) {
    var on = state.ids.indexOf(ing.id) !== -1;
    return '<button type="button" class="chip" data-id="' + escapeHtml(ing.id) + '" aria-pressed="' + String(on) + '">' + escapeHtml(ing.label) + "</button>";
  }

  function renderGroups() {
    var box = document.getElementById("pantry-groups");
    if (!box || !doc.picker) return;
    var groups = doc.picker.groups || [];
    var byGroup = {};
    visibleIngredients().forEach(function (ing) {
      (byGroup[ing.group] || (byGroup[ing.group] = [])).push(ing);
    });
    box.innerHTML = groups.map(function (g) {
      var items = (byGroup[g.id] || []).slice().sort(function (a, b) {
        return (freq[b.id] || 0) - (freq[a.id] || 0) || a.label.localeCompare(b.label);
      });
      var haveN = items.filter(function (i) { return state.ids.indexOf(i.id) !== -1; }).length;
      var openN = 8;
      var always = items.filter(function (i, idx) { return idx < openN || state.ids.indexOf(i.id) !== -1; });
      var rest = items.filter(function (i) { return always.indexOf(i) === -1; });
      var inner = '<div class="pantry-chips">' + always.map(chipBtn).join("") + "</div>";
      if (rest.length) {
        inner += '<details class="pantry-more"><summary>+' + rest.length + " more</summary><div class='pantry-chips'>" + rest.map(chipBtn).join("") + "</div></details>";
      }
      var tag = g.collapsed_by_default ? "details" : "fieldset";
      var open = g.collapsed_by_default ? "" : "";
      if (g.collapsed_by_default) {
        return '<details class="pantry-group" data-group="' + escapeHtml(g.id) + '"><summary>' + escapeHtml(g.label) + ' <span class="pantry-gtally">' + haveN + "/" + items.length + "</span></summary>" + inner + "</details>";
      }
      return '<fieldset class="pantry-group" data-group="' + escapeHtml(g.id) + '"><legend>' + escapeHtml(g.label) + ' <span class="pantry-gtally">' + haveN + "/" + items.length + "</span></legend>" + inner + "</fieldset>";
    }).join("");
  }

  function renderFocus() {
    var box = document.getElementById("pantry-focus");
    if (!box) return;
    if (state.ids.length < 1) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = '<p class="pantry-focus-label">Must use</p><div class="pantry-chips">' +
      state.ids.map(function (id) {
        var on = state.focus.indexOf(id) !== -1;
        var label = (catalog[id] && catalog[id].label) || id;
        return '<button type="button" class="chip" data-focus="' + escapeHtml(id) + '" aria-pressed="' + String(on) + '">' + escapeHtml(label) + "</button>";
      }).join("") + "</div>";
  }

  function renderExclude() {
    var box = document.getElementById("pantry-exclude-list");
    if (!box) return;
    if (!state.exclude.length) { box.innerHTML = ""; return; }
    box.innerHTML = state.exclude.map(function (id) {
      var label = (catalog[id] && catalog[id].label) || id;
      return '<button type="button" class="chip pantry-no" data-exclude="' + escapeHtml(id) + '" aria-pressed="true">' + escapeHtml(label) + '<span class="sr">, stop excluding</span></button>';
    }).join("");
  }

  function cardHtml(s) {
    return '<li class="card-item card"><a href="' + escapeHtml(recipeHref(s.recipe.url)) + '">' +
      '<h2>' + escapeHtml(s.recipe.title) + "</h2>" +
      (s.recipe.category ? '<p class="meta">' + escapeHtml(s.recipe.category) + "</p>" : "") +
      (s.usedLabels && s.usedLabels.length ? '<p class="pantry-uses">Uses: ' + escapeHtml(s.usedLabels.join(", ")) + "</p>" : "") +
      '<p class="pantry-badge' + (s.missingCount === 0 ? " have-all" : "") + '">' + escapeHtml(badgeFor(s)) + "</p>" +
      "</a></li>";
  }

  function renderResults() {
    var hasPicks = state.ids.some(function (id) {
      var assumed = assumedIds(doc, state.assumeStaples, state.assumeOils);
      return !assumed[id];
    }) || state.ids.length > 0;
    var empty = document.getElementById("pantry-empty");
    var list = document.getElementById("pantry-list");
    var countEl = document.getElementById("pantry-count");
    var ideas = document.getElementById("if-you-had");
    var jump = document.querySelector(".pantry-jump");
    if (!state.ids.length) {
      if (empty) {
        empty.hidden = false;
        empty.innerHTML = '<span class="hand">From the stove</span>Tap what you have in the kitchen, and we\'ll line up the recipes you can make.';
      }
      if (list) list.innerHTML = "";
      if (countEl) countEl.textContent = "Pick an ingredient to see what you can make.";
      if (ideas) ideas.innerHTML = "";
      if (jump) jump.hidden = true;
      return;
    }
    var packed = scored();
    var rows = packed.primary;
    var ready = rows.filter(function (s) { return s.missingCount === 0; }).length;
    var miss1 = packed.primary.filter(function (s) { return s.missingCount === 1; }).length;
    /* When missing-1 is on, still count and show can-make from this already-filtered primary list. */
    if (countEl) {
      countEl.innerHTML = "You can make <strong>" + ready + "</strong> recipe" + (ready === 1 ? "" : "s") +
        (miss1 ? " · <strong>" + miss1 + "</strong> more if you\'re missing 1" : "");
    }
    if (jump) {
      jump.hidden = false;
      jump.textContent = "Show " + rows.length + " recipe" + (rows.length === 1 ? "" : "s") + " ↓";
    }
    var html = "";
    if (!rows.length && !packed.other.length) {
      if (empty) {
        empty.hidden = false;
        empty.innerHTML = '<span class="hand">From the stove</span>Nothing in this kitchen matches that pantry. Try another ingredient, or <a href="/recipes/">see all recipes</a>.';
        var rec = document.querySelector('a[href*="recipes"]');
        if (rec && empty.querySelector("a")) empty.querySelector("a").href = rec.href;
      }
    } else if (empty) empty.hidden = true;

    if (state.missingOne && !rows.some(function (s) { return s.missingCount === 1; })) {
      html += '<p class="pantry-miss1-note">None of these are missing just 1 ingredient.</p>';
    }

    var can = rows.filter(function (s) { return s.missingCount === 0; });
    if (can.length) {
      html += '<section class="pantry-tier" data-tier="can-make"><h2>You can make these now <span>(' + can.length + ")</span></h2><ul class='cards'>";
      can.forEach(function (s) { html += cardHtml(s); });
      html += "</ul></section>";
    }
    var rest = rows.filter(function (s) { return s.missingCount > 0; });
    if (state.missingOne) {
      if (rest.length) {
        html += '<section class="pantry-tier" data-tier="missing-1"><h2>Missing 1 <span>(' + rest.length + ")</span></h2><ul class='cards'>";
        rest.forEach(function (s) { html += cardHtml(s); });
        html += "</ul></section>";
      }
    } else {
      var maxH = 0;
      rest.forEach(function (s) { if (s.mainHave > maxH) maxH = s.mainHave; });
      for (var h = maxH; h >= 1; h--) {
        var group = rest.filter(function (s) { return s.mainHave === h; });
        if (!group.length) continue;
        var label = "You have " + h + " of the main ingredients";
        html += '<section class="pantry-tier" data-tier="main-' + h + '"><h2>' + label + " <span>(" + group.length + ")</span></h2><ul class='cards'>";
        group.forEach(function (s) { html += cardHtml(s); });
        html += "</ul></section>";
      }
      var some = rest.filter(function (s) { return s.mainHave === 0; });
      if (some.length) {
        html += '<section class="pantry-tier" data-tier="some"><h2>Uses some of what you have <span>(' + some.length + ")</span></h2><ul class='cards'>";
        some.forEach(function (s) { html += cardHtml(s); });
        html += "</ul></section>";
      }
    }
    if (!state.missingOne && packed.other.length) {
      html += '<details class="pantry-tier pantry-other"><summary>Other recipes (' + packed.other.length + ") — none of your ingredients</summary><ul class='cards'>";
      packed.other.forEach(function (s) { html += cardHtml(s); });
      html += "</ul></details>";
    }
    if (list) list.innerHTML = html;

    var ideaRows = ifYouHad(rows);
    if (ideas) {
      if (!ideaRows.length) ideas.innerHTML = "";
      else ideas.innerHTML = '<h2>If you had…</h2><div class="pantry-chips">' + ideaRows.map(function (x) {
        return '<button type="button" class="chip" data-add="' + escapeHtml(x.id) + '">' + escapeHtml(x.line) + "</button>";
      }).join("") + "</div>";
    }
  }

  function syncToggles() {
    var s = document.getElementById("assume-staples");
    var o = document.getElementById("assume-oils");
    var m = document.getElementById("missing-one");
    if (s) s.checked = state.assumeStaples;
    if (o) o.checked = state.assumeOils;
    if (m) m.checked = state.missingOne;
  }

  var chipsBuilt = false;

  function isAssumedChip(id) {
    var assumed = assumedIds(doc, state.assumeStaples, state.assumeOils);
    return !!assumed[id];
  }

  function updateChipsInPlace() {
    document.querySelectorAll("button.chip[data-id]").forEach(function (btn) {
      if (btn.hasAttribute("data-add") || btn.hasAttribute("data-focus") || btn.hasAttribute("data-exclude")) return;
      if (btn.classList.contains("pantry-have") || btn.classList.contains("pantry-no")) return;
      var id = btn.getAttribute("data-id");
      var on = state.ids.indexOf(id) !== -1;
      btn.setAttribute("aria-pressed", String(on));
      var assumed = isAssumedChip(id);
      btn.classList.toggle("pantry-assumed", assumed);
      btn.hidden = assumed;
    });
    document.querySelectorAll(".pantry-group").forEach(function (g) {
      var chips = Array.prototype.slice.call(g.querySelectorAll("button.chip[data-id]")).filter(function (c) {
        return !c.hidden && !c.classList.contains("pantry-have");
      });
      var have = chips.filter(function (c) { return c.getAttribute("aria-pressed") === "true"; }).length;
      var tally = g.querySelector(".pantry-gtally");
      if (tally) tally.textContent = have + "/" + chips.length;
    });
  }

  function render(opts) {
    opts = opts || {};
    syncToggles();
    if (!chipsBuilt || opts.rebuildChips) {
      renderBasics();
      renderGroups();
      chipsBuilt = true;
    }
    updateChipsInPlace();
    renderSelected();
    renderFocus();
    renderExclude();
    renderResults();
    saveStorage();
    writeUrl(true);
  }

  function bind() {
    root.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-id]");
      if (btn && btn.hasAttribute("data-id") && !btn.hasAttribute("data-add")) {
        toggleId(btn.getAttribute("data-id"));
        render();
        return;
      }
      btn = ev.target.closest("button[data-add]");
      if (btn) { addId(btn.getAttribute("data-add")); render(); return; }
      btn = ev.target.closest("button[data-focus]");
      if (btn) {
        var fid = btn.getAttribute("data-focus");
        if (state.focus.indexOf(fid) === -1) state.focus.push(fid);
        else state.focus = state.focus.filter(function (x) { return x !== fid; });
        render();
        return;
      }
      btn = ev.target.closest("button[data-exclude]");
      if (btn) {
        var eid = btn.getAttribute("data-exclude");
        state.exclude = state.exclude.filter(function (x) { return x !== eid; });
        render();
      }
    });
    var staples = document.getElementById("assume-staples");
    var oils = document.getElementById("assume-oils");
    var miss1 = document.getElementById("missing-one");
    if (staples) staples.addEventListener("change", function () { state.assumeStaples = staples.checked; render(); });
    if (oils) oils.addEventListener("change", function () { state.assumeOils = oils.checked; render(); });
    if (miss1) miss1.addEventListener("change", function () { state.missingOne = miss1.checked; render(); });

    var clearBtn = document.getElementById("pantry-clear");
    if (clearBtn) clearBtn.addEventListener("click", function () {
      state.ids = [];
      state.exclude = [];
      state.focus = [];
      state.missingOne = false;
      render();
    });
    var shareBtn = document.getElementById("pantry-share");
    if (shareBtn) shareBtn.addEventListener("click", function () {
      var url = writeUrl(true);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { shareBtn.textContent = "Link copied"; setTimeout(function () { shareBtn.textContent = "Copy share link"; }, 1600); }).catch(function () { window.prompt("Copy this link", url); });
      } else window.prompt("Copy this link", url);
    });
    var copyBtn = document.getElementById("pantry-copy");
    if (copyBtn) copyBtn.addEventListener("click", function () {
      var text = state.ids.map(function (id) { return (catalog[id] && catalog[id].label) || id; }).join("\n");
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
    });

    var addEx = document.getElementById("pantry-exclude-add");
    if (addEx) addEx.addEventListener("change", function () {
      var id = addEx.value;
      if (id && state.exclude.indexOf(id) === -1) state.exclude.push(id);
      addEx.value = "";
      render();
    });

    setupAutocomplete();
  }

  function setupAutocomplete() {
    var input = document.getElementById("pantry-q");
    var list = document.getElementById("pantry-suggest");
    if (!input || !list) return;
    var aliases = aliasMap();
    var active = -1;
    var currentHits = [];

    function close() {
      list.hidden = true;
      list.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
      currentHits = [];
    }

    function rankRow(row, q) {
      if (row.q === q) return 0;
      if (row.q === q + "s" || q === row.q + "s") return 1;
      if (row.q.startsWith(q)) return 2;
      if (row.label.toLowerCase() === q) return 0;
      if (row.label.toLowerCase().startsWith(q)) return 2;
      if (row.q.indexOf(q) !== -1) return 3;
      return 9;
    }

    function matches(q) {
      q = (q || "").toLowerCase().trim();
      if (!q) return [];
      var best = {};
      aliases.forEach(function (row) {
        var r = rankRow(row, q);
        if (r > 8) return;
        var prev = best[row.id];
        if (!prev || r < prev.r || (r === prev.r && row.q === q)) best[row.id] = { r: r, row: row };
      });
      return Object.keys(best).map(function (id) { return best[id]; })
        .sort(function (a, b) { return a.r - b.r || a.row.label.localeCompare(b.row.label); })
        .map(function (x) { return x.row; })
        .slice(0, 8);
    }

    function highlight() {
      Array.prototype.forEach.call(list.querySelectorAll('[role="option"]'), function (li, i) {
        var on = i === active;
        li.classList.toggle("is-active", on);
        if (on) input.setAttribute("aria-activedescendant", li.id);
      });
      if (active < 0) input.removeAttribute("aria-activedescendant");
    }

    function show(hits, q) {
      currentHits = hits;
      active = -1;
      if (!hits.length) {
        if (q && q.trim()) {
          list.innerHTML = '<li class="pantry-nomatch" id="ps-none" aria-disabled="true">No match</li>';
          list.hidden = false;
          input.setAttribute("aria-expanded", "true");
          input.removeAttribute("aria-activedescendant");
        } else close();
        return;
      }
      list.innerHTML = hits.map(function (h, i) {
        var extra = h.alias && h.alias.toLowerCase() !== h.label.toLowerCase() ? " <span class='alias'>(" + escapeHtml(h.alias) + ")</span>" : "";
        return '<li role="option" data-id="' + escapeHtml(h.id) + '" id="ps-' + i + '">' + escapeHtml(h.label) + extra + "</li>";
      }).join("");
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");
    }

    function addFromQuery(raw) {
      var parts = parseList(raw);
      if (!parts.length && currentHits[0]) parts = [currentHits[0].label];
      var added = false;
      parts.forEach(function (part) {
        var hits = matches(part);
        if (hits[0]) { addId(hits[0].id); added = true; }
      });
      return added;
    }

    input.addEventListener("input", function () {
      var v = input.value;
      if (v.indexOf(",") !== -1 || v.indexOf("\n") !== -1) {
        var parts = parseList(v);
        if (parts.length > 1 && /[,|\n]\s*$/.test(v)) {
          /* trailing comma: already complete list items except last empty */
          parts.forEach(function (p) {
            var hits = matches(p);
            if (hits[0]) addId(hits[0].id);
          });
          input.value = "";
          close();
          render();
          return;
        }
      }
      show(matches(v), v);
    });
    input.addEventListener("paste", function () {
      setTimeout(function () {
        var parts = parseList(input.value);
        if (parts.length > 1) {
          parts.forEach(function (p) {
            var hits = matches(p);
            if (hits[0]) addId(hits[0].id);
          });
          input.value = "";
          close();
          render();
        } else {
          show(matches(input.value), input.value);
        }
      }, 0);
    });
    input.addEventListener("keydown", function (ev) {
      var opts = list.querySelectorAll('[role="option"]');
      if (ev.key === "ArrowDown") {
        if (list.hidden && input.value) show(matches(input.value), input.value);
        opts = list.querySelectorAll('[role="option"]');
        if (!opts.length) return;
        ev.preventDefault();
        active = Math.min(opts.length - 1, active + 1);
        highlight();
      } else if (ev.key === "ArrowUp") {
        if (!opts.length) return;
        ev.preventDefault();
        active = Math.max(0, active - 1);
        highlight();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (active >= 0 && opts[active]) addId(opts[active].getAttribute("data-id"));
        else if (!addFromQuery(input.value) && currentHits[0]) addId(currentHits[0].id);
        input.value = "";
        close();
        render();
      } else if (ev.key === "Escape") close();
    });
    list.addEventListener("click", function (ev) {
      var li = ev.target.closest("[data-id]");
      if (!li) return;
      addId(li.getAttribute("data-id"));
      input.value = "";
      close();
      render();
    });
    input.addEventListener("blur", function () { setTimeout(close, 150); });
  }

  function boot(data) {
    doc = data;
    catalog = catalogById(doc.ingredients);
    freq = {};
    (doc.recipes || []).forEach(function (r) {
      (r.all || []).forEach(function (id) { freq[id] = (freq[id] || 0) + 1; });
    });
    var ex = document.getElementById("pantry-exclude-add");
    if (ex) {
      visibleIngredients().slice().sort(function (a, b) { return a.label.localeCompare(b.label); }).forEach(function (ing) {
        var opt = document.createElement("option");
        opt.value = ing.id; opt.textContent = ing.label;
        ex.appendChild(opt);
      });
    }
    loadStorage();
    var fromUrl = applyUrl();
    if (fromUrl) saveStorage();
    bind();
    render();
  }

  var url = indexUrl();
  fetch(url, { credentials: "same-origin" })
    .then(function (res) {
      if (!res.ok) throw new Error("index " + res.status);
      return res.json();
    })
    .then(boot)
    .catch(function (err) {
      var empty = document.getElementById("pantry-empty");
      if (empty) {
        empty.hidden = false;
        empty.textContent = "The ingredient list could not be loaded. Try again in a moment.";
      }
      console.error(err);
    });

  if (typeof module !== "undefined") {
    module.exports = { pantrySatisfies: pantrySatisfies, scoreRecipe: scoreRecipe, catalogById: catalogById, badgeFor: badgeFor, descendants: descendants, ancestors: ancestors };
  }
})();

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 contents/tiptap 下的 Tiptap JSON 文档转换为本编辑器组件的数据格式
（core/types.ts 中的 DocumentData / BlockData）。

编辑器数据模型要点（参见 src/core/types.ts、src/core/state/store.ts）：
  DocumentData = { id?, blocks: BlockData[] }
  BlockData     = { id?, type, attrs?, content?, children? }
  content 是 InlineSeq：[{ type:'text', text, marks?:[{type, attrs?}] }]
  children 在编辑器 Phase 1 中基本为空（块是扁平的）。

与 Tiptap 的关键结构差异及映射规则：
  * paragraph / heading  -> 同类型块；textAlign -> align
  * bulletList / orderedList 是"容器"，编辑器里每个 listItem 是**独立的扁平块**
        （bulletList / orderedList），嵌套列表靠 indent 递增表示。
  * blockquote  -> 每个内部 paragraph 转为一个 quote 块
  * image       -> image 块，width/height 的 null 记为 0（=自适应）
  * horizontalRule -> divider 块
  * codeBlock   -> codeBlock 块（language，缺省 plain），inlineMarks=false 故去掉 code 标记
  * table       -> 单个 table 块，全部结构存在 attrs（TableAttrs）
  * text 内联节点：
        bold->bold, italic->italic, underline->underline,
        strike->strikethrough, code->code, link->{type:link,attrs:{href}}
        textStyle 的 backgroundColor / color（rgba/hex）就近映射到编辑器
            预设色（gray/brown/orange/yellow/green/blue/purple/pink/red）
        hardBreak -> 文本 '\n'（编辑器无内联换行，退而求其次保留在文本里）
        emoji     -> 对应字符（check_mark->✅, cross_mark->❌，未知用原名）

用法：
  python3 contents/convert_tiptap_to_editor.py
输出目录：contents/editor/<原名>.json，并生成 contents/editor/_report.json
"""

import json
import re
import os
import glob

SRC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tiptap")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "editor")

# --- 颜色：将任意 hex / rgb(a) 就近映射到编辑器预设色键 -----------------------
PRESETS = {
    "gray": "#9e9e9e", "brown": "#795548", "orange": "#ff9800", "yellow": "#ffeb3b",
    "green": "#4caf50", "blue": "#2196f3", "purple": "#9c27b0", "pink": "#e91e63",
    "red": "#f44336",
}


def parse_color(s):
    if not isinstance(s, str):
        return None
    s = s.strip()
    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) >= 6:
            try:
                return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
            except ValueError:
                return None
    if s.startswith("rgb"):
        nums = re.findall(r"[\d.]+", s)
        if len(nums) >= 3:
            return (int(float(nums[0])), int(float(nums[1])), int(float(nums[2])))
    return None


def hex_to_preset(s):
    rgb = parse_color(s)
    if not rgb:
        return None
    best, bd = None, 1e18
    for k, v in PRESETS.items():
        pr = parse_color(v)
        d = sum((a - b) ** 2 for a, b in zip(rgb, pr))
        if d < bd:
            bd, best = d, k
    return best


# --- emoji 名称 -> 字符 ------------------------------------------------------
EMOJI_MAP = {
    "check_mark": "✅",
    "cross_mark": "❌",
    "warning": "⚠️",
    "white_check_mark": "✅",
    "x": "❌",
}


def emoji_to_char(name):
    if name in EMOJI_MAP:
        return EMOJI_MAP[name]
    # 退回原 shortcode，避免丢信息
    return ":" + name + ":" if name else ""


# ---------------------------------------------------------------------------
# 内联内容转换
# ---------------------------------------------------------------------------

def convert_marks(marks):
    """Tiptap mark -> 编辑器 Mark。"""
    out = []
    for m in marks or []:
        mt = m.get("type")
        a = m.get("attrs") or {}
        if mt == "bold":
            out.append({"type": "bold"})
        elif mt == "italic":
            out.append({"type": "italic"})
        elif mt == "underline":
            out.append({"type": "underline"})
        elif mt in ("strike", "strikethrough"):
            out.append({"type": "strikethrough"})
        elif mt == "code":
            out.append({"type": "code"})
        elif mt == "link":
            href = a.get("href")
            if href:
                out.append({"type": "link", "attrs": {"href": href}})
        elif mt == "textStyle":
            color = a.get("color") or ""
            bg = a.get("backgroundColor") or ""
            if color:
                pk = hex_to_preset(color)
                if pk:
                    out.append({"type": "color", "attrs": {"color": pk}})
            if bg:
                pk = hex_to_preset(bg)
                if pk:
                    out.append({"type": "bgColor", "attrs": {"bgColor": pk}})
        # 其它 mark（如 sub/sup）编辑器暂不支持，忽略
    return out


def _marks_equal(a, b):
    if not a and not b:
        return True
    if not a or not b or len(a) != len(b):
        return False
    sa = sorted((m.get("type"), json.dumps(m.get("attrs", {}), sort_keys=True)) for m in a)
    sb = sorted((m.get("type"), json.dumps(m.get("attrs", {}), sort_keys=True)) for m in b)
    return sa == sb


def merge_runs(runs):
    """合并相邻、标记相同的文本 run。"""
    merged = []
    for r in runs:
        if r.get("type") != "text":
            merged.append(r)
            continue
        last = merged[-1] if merged else None
        if last and last.get("type") == "text" and _marks_equal(last.get("marks"), r.get("marks")):
            last["text"] = last["text"] + r["text"]
        else:
            merged.append({"type": "text", "text": r["text"], **({"marks": r["marks"]} if r.get("marks") else {})})
    return merged


def convert_inline(nodes):
    """Tiptap 内联节点数组 -> InlineSeq。"""
    runs = []
    for n in nodes or []:
        t = n.get("type")
        if t == "text":
            text = n.get("text", "")
            marks = convert_marks(n.get("marks", []))
            runs.append({"type": "text", "text": text, **({"marks": marks} if marks else {})})
        elif t == "hardBreak":
            runs.append({"type": "text", "text": "\n"})
        elif t == "emoji":
            runs.append({"type": "text", "text": emoji_to_char((n.get("attrs") or {}).get("name", ""))})
        # 其它内联类型（如 mention）暂忽略
    return merge_runs(runs)


def convert_inline_strip_marks(nodes):
    """用于 codeBlock：编辑器 inlineMarks=false，去掉所有标记，只保留纯文本。"""
    runs = []
    for n in nodes or []:
        if n.get("type") == "text":
            runs.append({"type": "text", "text": n.get("text", "")})
        elif n.get("type") == "hardBreak":
            runs.append({"type": "text", "text": "\n"})
    return merge_runs(runs)


# ---------------------------------------------------------------------------
# 块级转换
# ---------------------------------------------------------------------------

def make_text_block(block_type, node, indent=0, extra_attrs=None, allow_indent=True):
    """由 paragraph / heading 等"文本块"节点生成编辑器块。
    block_type 可为 paragraph/heading/quote/bulletList/orderedList。"""
    attrs = {}
    node_attrs = node.get("attrs") or {}
    ta = node_attrs.get("textAlign")
    if ta and ta != "left":
        attrs["align"] = ta
    if allow_indent and indent > 0:
        attrs["indent"] = indent
    if extra_attrs:
        attrs.update(extra_attrs)
    block = {"type": block_type}
    if attrs:
        block["attrs"] = attrs
    content = convert_inline(node.get("content", []))
    if content:
        block["content"] = content
    return block


def convert_list(node, list_type, indent, start=None):
    """Tiptap bulletList/orderedList -> 多个扁平的 bulletList/orderedList 块。

    编辑器里 startNumber 是「强制该项序号」的显式覆盖，会打断自动续号，
    因此只在该 orderedList 的**第一项**上设置，且取 tiptap 的 start
    （缺省 1）。这样既保留非 1 的起始值，又让后续项自动续号；多个相邻
    有序列表也因首项各自带 startNumber 而从 1 重新开始。
    """
    out = []
    is_ordered = list_type == "orderedList"
    list_start = int(start) if isinstance(start, int) else 1
    first_item_done = False
    for item in node.get("content", []):
        if item.get("type") != "listItem":
            continue
        children = item.get("content", [])
        first = None
        nested = []
        rest = []
        for c in children:
            ct = c.get("type")
            if first is None and ct in ("paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList"):
                first = c
            elif ct in ("bulletList", "orderedList"):
                nested.append(c)
            else:
                rest.append(c)
        item_attrs = {}
        if indent > 0:
            item_attrs["indent"] = indent
        if is_ordered and not first_item_done:
            item_attrs["startNumber"] = list_start
        first_item_done = True
        if first is None:
            blk = {"type": list_type}
            if item_attrs:
                blk["attrs"] = item_attrs
            out.append(blk)
        elif first.get("type") in ("paragraph", "heading"):
            blk = make_text_block(list_type, first, indent=indent, extra_attrs=(item_attrs or None))
            out.append(blk)
        else:
            # 罕见：listItem 首块本身就是列表（嵌套直接写在 item 里）
            out.extend(convert_block(first, indent))
        # 嵌套列表：indent + 1
        for n in nested:
            child_start = (n.get("attrs") or {}).get("start")
            out.extend(convert_list(n, n.get("type"), indent + 1, child_start))
        # 其余块（如 listItem 内的额外段落）按普通块处理
        for r in rest:
            out.extend(convert_block(r, indent))
    return out


def convert_table(node):
    """Tiptap table -> 编辑器 table 块（结构全部存进 attrs）。"""
    row_nodes = node.get("content", [])
    row_cells = []
    max_cols = 0
    for row in row_nodes:
        cells = []
        for c in row.get("content", []):
            a = c.get("attrs") or {}
            cs = int(a.get("colspan", 1) or 1)
            rs = int(a.get("rowspan", 1) or 1)
            cells.append((c, cs, rs, c.get("type") == "tableHeader"))
        row_cells.append(cells)
        max_cols = max(max_cols, sum(cs for _, cs, _, _ in cells))
    rows = len(row_cells)
    cols = max_cols if max_cols > 0 else 1

    grid = [[None] * cols for _ in range(rows)]
    covered = [[False] * cols for _ in range(rows)]
    for r in range(rows):
        c = 0
        for (cell, cs, rs, is_h) in row_cells[r]:
            while c < cols and grid[r][c] is not None:
                c += 1
            if c >= cols:
                break
            for rr in range(r, min(r + rs, rows)):
                for cc in range(c, min(c + cs, cols)):
                    if rr == r and cc == c:
                        grid[rr][cc] = {"cell": cell, "cs": cs, "rs": rs, "isH": is_h}
                    else:
                        covered[rr][cc] = True
            c += cs

    cells_out = []
    col_widths = []
    for r in range(rows):
        row_out = []
        for c in range(cols):
            if covered[r][c]:
                row_out.append({"content": [], "rowspan": 1, "colspan": 1, "covered": True})
                continue
            entry = grid[r][c]
            if entry is None:
                row_out.append({"content": [], "rowspan": 1, "colspan": 1, "covered": False})
                continue
            cell = entry["cell"]
            cs, rs, is_h = entry["cs"], entry["rs"], entry["isH"]
            a = cell.get("attrs") or {}
            cell_inline = []
            for blk in cell.get("content", []):
                if blk.get("type") == "paragraph":
                    cell_inline.extend(convert_inline(blk.get("content", [])))
                elif blk.get("type") == "heading":
                    cell_inline.extend(convert_inline(blk.get("content", [])))
                else:
                    cell_inline.extend(convert_inline(blk.get("content", []) if isinstance(blk.get("content"), list) else []))
            content = merge_runs(cell_inline)
            cell_obj = {"content": content, "rowspan": rs, "colspan": cs, "covered": False}
            al = a.get("align")
            if al in ("left", "center", "right"):
                cell_obj["align"] = al
            bg = a.get("backgroundColor") or ""
            if bg:
                pk = hex_to_preset(bg)
                if pk:
                    cell_obj["bgColor"] = pk
            row_out.append(cell_obj)
            if r == 0:
                while len(col_widths) <= c:
                    col_widths.append(0)
                cw = a.get("colwidth")
                if isinstance(cw, list) and cw and isinstance(cw[0], (int, float)):
                    col_widths[c] = int(cw[0])
        cells_out.append(row_out)

    while len(col_widths) < cols:
        col_widths.append(0)

    first_row_h = rows > 0 and any(e and e["isH"] for e in grid[0])
    table_attrs = {
        "rows": rows,
        "cols": cols,
        "cells": cells_out,
        "colWidths": col_widths,
        "headerRow": bool(first_row_h),
    }
    return {"type": "table", "attrs": table_attrs}


def convert_block(node, indent=0):
    """转换单个 Tiptap 块节点，可能展开为多个编辑器块。"""
    t = node.get("type")
    if t == "paragraph":
        return [make_text_block("paragraph", node, indent)]
    if t == "heading":
        level = int((node.get("attrs") or {}).get("level", 1))
        level = max(1, min(6, level))
        return [make_text_block("heading", node, indent, extra_attrs={"level": level})]
    if t in ("bulletList", "orderedList"):
        return convert_list(node, t, indent, (node.get("attrs") or {}).get("start"))
    if t == "blockquote":
        out = []
        for child in node.get("content", []):
            if child.get("type") == "paragraph":
                out.append(make_text_block("quote", child, indent, allow_indent=False))
            else:
                out.extend(convert_block(child, indent))
        return out
    if t == "image":
        a = node.get("attrs") or {}
        return [{
            "type": "image",
            "attrs": {
                "src": a.get("src", "") or "",
                "alt": a.get("alt") or "",
                "title": a.get("title") or "",
                "width": int(a.get("width") or 0),
                "height": int(a.get("height") or 0),
            },
        }]
    if t == "horizontalRule":
        return [{"type": "divider"}]
    if t == "codeBlock":
        a = node.get("attrs") or {}
        lang = a.get("language") or "plain"
        block = {"type": "codeBlock", "attrs": {"language": lang}}
        content = convert_inline_strip_marks(node.get("content", []))
        if content:
            block["content"] = content
        return [block]
    if t == "table":
        return [convert_table(node)]
    # 未知块类型：若含内联文本则降级为段落，否则丢弃
    return []


def convert_document(doc):
    blocks = []
    for node in doc.get("content", []):
        blocks.extend(convert_block(node, 0))
    return blocks


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(SRC_DIR, "*.json")))
    report = {"converted": [], "errors": []}
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0]
        try:
            with open(f, "r", encoding="utf-8") as fh:
                doc = json.load(fh)
            blocks = convert_document(doc)
            out = {"id": "doc-" + name, "blocks": blocks}
            out_path = os.path.join(OUT_DIR, name + ".json")
            with open(out_path, "w", encoding="utf-8") as fh:
                json.dump(out, fh, ensure_ascii=False, indent=2)
            block_types = {}
            for b in blocks:
                block_types[b["type"]] = block_types.get(b["type"], 0) + 1
            report["converted"].append({
                "source": os.path.basename(f),
                "output": os.path.basename(out_path),
                "block_count": len(blocks),
                "block_types": block_types,
            })
        except Exception as e:  # noqa
            report["errors"].append({"source": os.path.basename(f), "error": str(e)})
    with open(os.path.join(OUT_DIR, "_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print("转换完成：{} 个文件，{} 个出错".format(len(report["converted"]), len(report["errors"])))
    for c in report["converted"]:
        print("  {} -> {} 块 ({}）".format(c["source"], c["block_count"], c["block_types"]))
    if report["errors"]:
        for e in report["errors"]:
            print("  ERROR {}: {}".format(e["source"], e["error"]))


if __name__ == "__main__":
    main()

let d, clrs, style

d = console.log

//!baseTheme

import { EditorView } from '@codemirror/view'

function bgDec
(bg, bold) {
  let fg, c

  fg = bg - 10
  c = clrs[fg]
  return bold ? c.boldBg : c.bg
}

function isBg
(num) {
  return (num >= 40) && (num <= 47)
}

function isClr
(num) {
  return isBg(num) || clrs[num]
}

function makeDec
(attr) {
  let css

  css = ''
  if (attr.fg)
    css += ' cm-ansi-' + clrs[attr.fg].name
  if (attr.bg)
    css += ' cm-ansi-' + clrs[attr.bg - 10].name + '-bg'
  if (attr.bold)
    css += ' cm-ansi-bold'
  return Decoration.mark({ attributes: { class: css } })
}

function clr
(name, color) {
  let css

  css = 'cm-ansi-' + name
  if (color) {
    style['.' + css] = { color: color }
    style['.' + css + '-bg'] = { backgroundColor: color }
  }
  else {
    // special case for regular fg with bold (eg ESC[1m or ESC[1;40m)
    style['.' + css] = {}
    style['.' + css + '-bg'] = {}
  }
  return { name: name,
           norm: Decoration.mark({ attributes: { class: css } }),
           bg: Decoration.mark({ attributes: { class: css + '-bg' } }),
           bold: Decoration.mark({ attributes: { class: css + ' cm-ansi-bold' } }),
           boldBg: Decoration.mark({ attributes: { class: css + '-bg cm-ansi-bold' } }) }
}

function clr2
(i, name, color, bright) {
  clrs[i] = clr(name, color)
  clrs[i + 60] = clr('bright' + name, bright)
}

style = { '.cm-ansi-bold': { fontWeight: 'bold' } }
clrs = []
clrs[1] = clr('text', null)
clr2(30, 'black', '#000000', '#555555')
clr2(31, 'red', '#AA0000', '#FF5555')
clr2(32, 'green', '#00AA00', '#55FF55')
clr2(33, 'yellow', '#AA5500', '#FFFF55')
clr2(34, 'blue', '#0000AA', '#5555FF')
clr2(35, 'magenta', '#AA00AA', '#FF55FF')
clr2(36, 'cyan', '#00AAAA', '#55FFFF')
clr2(37, 'white', '#AAAAAA', '#FFFFFF')

const baseTheme = EditorView.baseTheme(style)

//!facet

import { Facet } from '@codemirror/state'

const stepSize = Facet.define({
  combine: values => values.length ? Math.min(...values) : 2
})

//!constructor

export function ansi
(options = {}) {
  return [ baseTheme,
           options.step == null ? [] : stepSize.of(options.step),
           showAnsi ]
}

//!ansiDeco

import { Decoration } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

let hide, csRe

hide = Decoration.replace({})
// Select Graphic Rendition
// https://en.wikipedia.org/wiki/ANSI_escape_code#SGR
// ESC[m
// ESC[1m
// ESC[1;32m
// ESC[1;32;43m
csRe = /\x1B\[([0-9]*)((?:;[0-9]+)*)m/gd // (?: ) is non capturing group

function decoLine
(builder, cache, line) {
  let fg, bg, bold, ranges, hit, matches

  function boldOn
  () {
    bold = 1
  }

  function boldOff
  () {
    bold = 0
  }

  function push
  (attr) {
    attr.cache = 1
    if (attr.from == undefined)
      // pushing for the line cache, eg for reset
      attr.skipStyle = 1
    else if (attr.hide) {
      // this 'attribute' hides the control sequences
      attr.dec = hide
      // cache is for attributes that affect the style
      attr.cache = 0
    }
    else if (attr.bg && attr.fg)
      attr.dec = makeDec(attr)
    else if (attr.bg)
      attr.dec = bgDec(attr.bg, attr.bold)
    else if (attr.fg)
      attr.dec = attr.bold ? clrs[attr.fg].bold : clrs[attr.fg].norm
    else if (attr.bold)
      attr.dec = clrs[1].bold
    ranges.push(attr)
  }

  function add
  (from, len /* of marker */, to, num, init) {
    //d('add ' + from + ' ' + len + ' ' + to + ' ' + num + ' ' + init)
    // terminate previous
    if (init) {
      // skip because initializing line with cached info from previous line
    }
    else if ((fg || bg || bold) && ranges.length) {
      let last

      last = ranges.at(-1)
      last.to = from
    }
    // hide control sequence
    if (1)
      push({ from: from, to: from + len, hide: 1 })
    // reset
    if (num == 0) {
      fg = 0
      bg = 0
      push({ bold: 0, fg: fg, bg: bg }) // dummy, for cache
      boldOff()
      return
    }
    // weight change
    if ([ 1, 22 ].includes(num)) {
      if (num == 22) {
        // normal
        boldOff()
        if (fg || bg)
          push({ from: from + len, to: to, fg: fg, bg: bg, bold: 0 })
        else
          push({ bold: 0, fg: 0, bg: 0 }) // dummy, for cache
      }
      if (num == 1) {
        // bold
        boldOn()
        push({ from: from + len, to: to, fg: fg, bg: bg, bold: 1 })
      }
      return
    }
    // default fg
    if (num == 39) {
      fg = 0
      if (bg || bold)
        push({ from: from + len, to: to, fg: fg, bg: bg, bold: bold })
      else
        push({ bold: 0, fg: 0, bg: 0 }) // dummy, for cache
      return
    }
    // default bg
    if (num == 49) {
      bg = 0
      if (fg || bold)
        push({ from: from + len, to: to, fg: fg, bg: bg, bold: bold })
      else
        push({ bold: 0, fg: 0, bg: 0 }) // dummy, for cache
      return
    }
    // color
    if (isClr(num)) {
      if (isBg(num))
        bg = num
      else
        fg = num
      push({ from: from + len, to: to, fg: fg, bg: bg, bold: bold })
      return
    }
  }

  function addAttr
  (line,
   start, // of control sequence, offset into line
   end, // of control sequence, offset into line
   slice,
   init) {
    let num

    num = parseInt(slice)
    add(line.from + start, end - start, line.to, num, init)
  }

  function addGroup
  (line, start, end, group) {
    let slice, num

    if (group[0] == group[1])
      // should only happen for first group, via ESC[m;
      num = 0
    else {
      slice = line.text.slice(group[0])
      num = parseInt(slice)
    }
    add(line.from + start, end - start, line.to, num)
  }

  ranges = []
  if (line.number > 0)
    hit = cache[line.number - 1]
  fg = hit?.fg || 0
  bg = hit?.bg || 0
  bold = hit?.bold || 0
  if (hit) {
    if (0) {
      d('hit ' + line.number)
      d('fg ' + hit.fg)
      d('bg ' + hit.bg)
      d('bold ' + hit.bold)
    }
    // Only one because they're in the same position.
    // Will pick up other values from fg/bg/bold vars in add.
    // Last arg 1 to prevent closing previous attr, because we're starting a new line.
    if (hit.fg)
      addAttr(line, 0, 0, hit.fg, 1)
    else if (hit.bg)
      addAttr(line, 0, 0, hit.bg, 1)
    else if (hit.bold)
      addAttr(line, 0, 0, 1, 1)
  }
  csRe.lastIndex = 0
  matches = line.text.matchAll(csRe)
  for (const match of matches) {
  // matches.forEach(match => {
    let start, end

    start = match.indices[0][0]
    end = match.indices[0][1]
    // First attribute has own group
    addGroup(line, start, end, match.indices[1])
    // Remaining attributes need to be split
    if (match.indices.length > 2) {
      let group2

      group2 = match.indices[2]
      if (group2[0] == group2[1])
        continue
      line.text.slice(group2[0], group2[1]).split(';').forEach(attr => {
        if (attr.length)
          addAttr(line, start, end, attr)
      })
    }
  }
  ranges.forEach(r => r.skipStyle || builder.add(r.from, r.to, r.dec))
  {
    let filtered

    filtered = ranges.filter(r => r.cache)
    if (filtered.length) {
      cache[line.number] = filtered.at(-1)
      if (0) {
        d('cached ' + line.number)
        d('fg ' + cache[line.number].fg)
        d('bg ' + cache[line.number].bg)
        d('bold ' + cache[line.number].bold)
      }
    }
  }
}

function ansiDeco
(view) {
  let builder, cache

  builder = new RangeSetBuilder()
  cache = []
  for (let { from, to } of view.visibleRanges)
    for (let pos = from; pos <= to;) {
      let line

      line = view.state.doc.lineAt(pos)
      decoLine(builder, cache, line)
      pos = line.to + 1
    }
  return builder.finish()
}

//!showAnsi

import { ViewPlugin } from '@codemirror/view'

const showAnsi = ViewPlugin.fromClass(class {
  constructor
  (view) {
    this.decorations = ansiDeco(view)
  }

  update
  (update) {
    if (update.docChanged || update.viewportChanged)
      this.decorations = ansiDeco(update.view)
  }
}, {
  decorations: v => v.decorations
})

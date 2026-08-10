/**
 * A living checklist for dead-pedal.
 *
 * Plain DOM, no framework: the whole thing is one render function over an array
 * and a Set of ticked ids, and reaching for a component library to draw
 * checkboxes would cost more than it saved.
 *
 * Ticks live in localStorage rather than in `milestones.ts`, so marking
 * something off is a click rather than a commit. The shipped `done` flags are
 * the baseline a fresh clone starts from; anything you tick or untick here
 * overrides them locally.
 */
import { MILESTONES, type Milestone, type Task } from './milestones'

const STORE = 'dead-pedal:progress'

type Overrides = Record<string, boolean>

function load(): Overrides {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as Overrides
  } catch {
    // A corrupt entry should cost you your ticks, not the page.
    return {}
  }
}

let overrides = load()
let hideDone = false

const isDone = (task: Task): boolean => overrides[task.id] ?? task.done

function save(): void {
  localStorage.setItem(STORE, JSON.stringify(overrides))
}

function countDone(milestone: Milestone): number {
  return milestone.tasks.filter(isDone).length
}

/** Escapes text before it goes near innerHTML. Notes are prose, not markup. */
function text(value: string): string {
  const node = document.createElement('span')
  node.textContent = value
  return node.innerHTML
}

function bar(done: number, total: number, tint: string): string {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return `
    <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div class="h-full ${tint} transition-all duration-300" style="width:${percent}%"></div>
    </div>`
}

function statusPill(done: number, total: number): string {
  if (done === total) {
    return `<span class="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400">complete</span>`
  }
  if (done === 0) {
    return `<span class="rounded-full bg-slate-700/40 px-2.5 py-1 text-xs font-medium text-slate-400">not started</span>`
  }
  return `<span class="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-400">in progress</span>`
}

function taskRow(task: Task): string {
  const done = isDone(task)
  return `
    <li class="group flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-slate-800/40">
      <input
        type="checkbox"
        id="${task.id}"
        data-task="${task.id}"
        ${done ? 'checked' : ''}
        class="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500"
      />
      <label for="${task.id}" class="cursor-pointer select-none">
        <span class="${done ? 'text-slate-500 line-through' : 'text-slate-200'}">${text(task.label)}</span>
        ${
          !done && task.deferred === true
            ? `<span class="ml-2 rounded bg-slate-700/40 px-1.5 py-0.5 align-middle text-[10px] uppercase tracking-wider text-slate-400">parked</span>`
            : ''
        }
        ${
          task.note === undefined
            ? ''
            : `<span class="mt-0.5 block text-xs leading-relaxed text-slate-500">${text(task.note)}</span>`
        }
      </label>
    </li>`
}

function card(milestone: Milestone): string {
  const total = milestone.tasks.length
  const done = countDone(milestone)
  const tasks = hideDone ? milestone.tasks.filter((t) => !isDone(t)) : milestone.tasks
  if (tasks.length === 0 && hideDone) return ''

  return `
    <section class="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <header class="mb-4">
        <div class="flex items-center gap-3">
          <span class="font-mono text-sm text-slate-500">${milestone.id}</span>
          <h2 class="flex-1 text-lg font-semibold text-slate-100">${text(milestone.title)}</h2>
          ${statusPill(done, total)}
          <span class="font-mono text-xs text-slate-500">${done}/${total}</span>
        </div>
        <p class="mt-2 text-sm italic leading-relaxed text-slate-400">${text(milestone.doneWhen)}</p>
        <div class="mt-3">${bar(done, total, done === total ? 'bg-emerald-500' : 'bg-amber-500')}</div>
      </header>
      <ul class="space-y-0.5">${tasks.map(taskRow).join('')}</ul>
    </section>`
}

/** Work that is genuinely outstanding — not done, and not parked on purpose. */
const live = (task: Task): boolean => !isDone(task) && task.deferred !== true

/**
 * The first milestone with live work in it.
 *
 * Deferred tasks are skipped deliberately. Without that the tracker points at
 * M6's two parked items — both unreachable in a one-round mode — and "up next"
 * stops meaning "next".
 */
function focus(): Milestone | undefined {
  return MILESTONES.find((m) => m.tasks.some(live))
}

function render(): void {
  const app = document.getElementById('app')
  if (app === null) throw new Error('tracker: missing #app')

  const all = MILESTONES.flatMap((m) => m.tasks)
  const done = all.filter(isDone).length
  const next = focus()
  const remaining = next === undefined ? [] : next.tasks.filter(live)

  app.innerHTML = `
    <header class="mb-8">
      <div class="flex items-baseline gap-3">
        <h1 class="text-2xl font-bold tracking-tight text-slate-50">dead-pedal</h1>
        <span class="text-sm text-slate-500">vehicular combat · TypeScript + three.js</span>
      </div>
      <div class="mt-4 flex items-center gap-4">
        <div class="flex-1">${bar(done, all.length, 'bg-emerald-500')}</div>
        <span class="font-mono text-sm text-slate-400">${done}/${all.length}</span>
        <span class="font-mono text-sm text-emerald-400">${Math.round((done / all.length) * 100)}%</span>
      </div>
    </header>

    ${
      next === undefined
        ? `<div class="mb-8 rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-5 text-emerald-300">
             Everything is ticked. Either you shipped it or the checklist is lying to you.
           </div>`
        : `<div class="mb-8 rounded-xl border border-amber-800/40 bg-amber-950/20 p-5">
             <div class="text-xs font-medium uppercase tracking-wider text-amber-500">Up next</div>
             <div class="mt-1 text-lg font-semibold text-slate-100">
               ${next.id} — ${text(next.title)}
             </div>
             <ul class="mt-3 space-y-1">
               ${remaining
                 .slice(0, 4)
                 .map((t) => `<li class="text-sm text-slate-400">· ${text(t.label)}</li>`)
                 .join('')}
               ${
                 remaining.length > 4
                   ? `<li class="text-sm text-slate-600">· and ${remaining.length - 4} more</li>`
                   : ''
               }
             </ul>
           </div>`
    }

    <div class="mb-4 flex items-center justify-between">
      <label class="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-400">
        <input type="checkbox" id="hide-done" ${hideDone ? 'checked' : ''}
          class="h-4 w-4 cursor-pointer rounded border-slate-600 bg-slate-800 accent-emerald-500" />
        Hide what is done
      </label>
      <button id="reset" class="text-xs text-slate-600 hover:text-slate-400">
        reset my ticks
      </button>
    </div>

    <div class="space-y-4">${MILESTONES.map(card).join('')}</div>

    <footer class="mt-10 border-t border-slate-800 pt-5 text-xs leading-relaxed text-slate-600">
      Ticks are stored in this browser only. The baseline lives in
      <span class="font-mono text-slate-500">tracker/milestones.ts</span> — update it there when
      something genuinely lands, so a fresh clone starts from the truth.
    </footer>`

  for (const box of app.querySelectorAll<HTMLInputElement>('[data-task]')) {
    box.addEventListener('change', () => {
      const id = box.dataset.task
      if (id === undefined) return
      overrides[id] = box.checked
      save()
      render()
    })
  }

  document.getElementById('hide-done')?.addEventListener('change', (event) => {
    hideDone = (event.target as HTMLInputElement).checked
    render()
  })

  document.getElementById('reset')?.addEventListener('click', () => {
    overrides = {}
    save()
    render()
  })
}

render()

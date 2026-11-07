import { deriveTaskRows, sameRows, currentSessionId, directoryLabel, createPopupState, createOutcomeLoader } from './model.mjs';

/** Two additive seats only: a footer action and a native modal in shell.overlay. */
export function createClientPlugin(React) {
  const h = React.createElement;
  const NS = 'local.runningSessions';
  const DIALOG_ID = 'local-running-sessions-dialog';
  const en = {
    title: 'Task list', trigger: 'Tasks', open: 'View task list ({count})',
    subtitle: 'All workspaces · green marks new, unread completions', close: 'Close',
    empty: 'No conversations yet', loading: 'Syncing conversations…', untitled: 'Untitled',
    count: '{count} conversations', running: 'Running', children: 'Subagents running',
    approval: 'Waiting for approval', 'plan-review': 'Plan awaiting review', question: 'Waiting for answer',
    queued: 'Queued', completed: 'Completed', newlyCompleted: 'Completed · unread', error: 'Failed', aborted: 'Stopped', blocked: 'Blocked',
    'max-tokens': 'Output limit reached', interrupted: 'Interrupted', forked: 'Forked', unknown: 'Result unconfirmed',
    openError: 'Could not open this conversation. Please try again.',
  };
  const zh = {
    title: '任务列表', trigger: '任务列表', open: '查看任务列表（{count}）',
    subtitle: '全部工作区 · 绿点表示新完成且未查看', close: '关闭',
    empty: '暂无会话', loading: '正在同步会话…', untitled: '未命名',
    count: '{count} 个会话', running: '运行中', children: '子任务运行中',
    approval: '等待批准', 'plan-review': '等待计划审核', question: '等待回答',
    queued: '等待执行', completed: '已完成', newlyCompleted: '新完成 · 未查看', error: '执行失败', aborted: '已停止', blocked: '已阻止',
    'max-tokens': '输出已达上限', interrupted: '已中断', forked: '分支会话', unknown: '结果待确认',
    openError: '无法打开此会话，请重试。',
  };
  const css = `
.dsh-rs-trigger { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; gap: 5px; min-width: 28px; height: 28px; box-sizing: border-box; padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-rs-trigger:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-rs-trigger:focus-visible, .dsh-rs-close:focus-visible, .dsh-rs-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dsh-rs-trigger[data-rail="true"] { position: relative; width: 28px; padding: 0; }
.dsh-rs-count { display: inline-block; min-width: 17px; padding: 0 4px; box-sizing: border-box; border-radius: 5px; text-align: center; font-size: 11px; line-height: 17px; font-weight: 500; font-variant-numeric: tabular-nums; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.dsh-rs-count[data-active="true"] { color: var(--dsw-alias-brand-primary); }
.dsh-rs-trigger[data-rail="true"] .dsh-rs-count { position: absolute; right: -4px; top: -5px; min-width: 14px; padding: 0 3px; font-size: 9px; line-height: 14px; }
.dsh-rs-dialog { pointer-events: auto; box-sizing: border-box; width: min(580px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 64px); margin: auto; padding: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); font-family: inherit; box-shadow: 0 12px 48px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent); }
.dsh-rs-dialog::backdrop { pointer-events: auto; background: var(--dsw-alias-bg-base); opacity: .7; }
.dsh-rs-content { display: flex; flex-direction: column; max-height: calc(100dvh - 66px); min-width: 0; }
.dsh-rs-header { display: flex; flex: 0 0 auto; align-items: flex-start; gap: 12px; padding: 20px 20px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-rs-heading { flex: 1; min-width: 0; }
.dsh-rs-heading-line { display: flex; align-items: center; gap: 8px; }
.dsh-rs-heading h2 { margin: 0; font-size: 16px; font-weight: 600; line-height: 24px; color: var(--dsw-alias-label-primary); }
.dsh-rs-subtitle { margin: 5px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-rs-close { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-rs-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-rs-list { list-style: none; min-height: 0; max-height: min(60vh, 520px); overflow-y: auto; overscroll-behavior: contain; padding: 8px 10px 12px; margin: 0; scrollbar-width: thin; }
.dsh-rs-list li { padding: 0; margin: 2px 0 0; }
.dsh-rs-row { display: flex; width: 100%; min-width: 0; min-height: 54px; align-items: center; gap: 12px; box-sizing: border-box; border: 0; border-radius: 8px; padding: 9px 10px; color: var(--dsw-alias-label-primary); background: transparent; text-align: start; font: inherit; font-size: 13px; cursor: pointer; }
.dsh-rs-row:hover, .dsh-rs-row[aria-current="page"] { background: var(--dsw-alias-bg-layer-2); }
.dsh-rs-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 3px; }
.dsh-rs-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; }
.dsh-rs-directory { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
.dsh-rs-status { flex: 0 0 auto; max-width: 30%; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 18px; }
.dsh-rs-status[data-phase="completed"][data-new-completion="true"] { color: var(--dsw-alias-state-success-primary); }
.dsh-rs-status[data-phase="error"] { color: var(--dsw-alias-state-error-primary); }
.dsh-rs-status[data-phase="approval"], .dsh-rs-status[data-phase="plan-review"], .dsh-rs-status[data-phase="question"], .dsh-rs-status[data-phase="queued"], .dsh-rs-status[data-phase="blocked"], .dsh-rs-status[data-phase="max-tokens"] { color: var(--dsw-alias-state-warn-primary); }
.dsh-rs-spinner { flex: 0 0 auto; width: 12px; height: 12px; box-sizing: border-box; border: 1.5px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); border-right-color: var(--dsw-alias-brand-primary); border-radius: 50%; animation: dsh-rs-spin 1s linear infinite; }
.dsh-rs-dot { flex: 0 0 auto; width: 7px; height: 7px; margin: 0 2.5px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.dsh-rs-dot[data-phase="completed"][data-new-completion="true"] { background: var(--dsw-alias-state-success-primary); }
.dsh-rs-dot[data-phase="error"] { background: var(--dsw-alias-state-error-primary); }
.dsh-rs-dot[data-phase="approval"], .dsh-rs-dot[data-phase="plan-review"], .dsh-rs-dot[data-phase="question"], .dsh-rs-dot[data-phase="queued"], .dsh-rs-dot[data-phase="blocked"], .dsh-rs-dot[data-phase="max-tokens"] { background: var(--dsw-alias-state-warn-primary); }
.dsh-rs-empty { margin: 0; padding: 40px 20px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 22px; }
.dsh-rs-error { margin: 0; padding: 8px 20px 14px; color: var(--dsw-alias-state-error-primary); font-size: 12px; }
@keyframes dsh-rs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dsh-rs-spinner { animation: none; } }
@media (max-width: 420px) { .dsh-rs-header { padding: 16px; } .dsh-rs-row { gap: 8px; } }
`;

  function ListIcon() {
    return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: 'M3 3.5v6l5-3zM12 6.5h9M4 14h2m6 0h9M4 21h2m6 0h9' }));
  }
  function CloseIcon() {
    return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true }, h('path', { d: 'm6 6 12 12M18 6 6 18' }));
  }
  function useRows(props) {
    const statuses = props.useSessionStatus(value => value);
    const archived = props.useWorkspaces(value => value.archivedSessionIds);
    return props.useSessions(value => deriveTaskRows(value, statuses, archived, props.completionTrackingStartedAt), sameRows);
  }
  function Trigger(props) {
    const rows = useRows(props);
    const open = props.usePopup(value => value.open);
    const title = props.t('open', { count: rows.length });
    return h(React.Fragment, null, h('style', null, css), h('button', {
      type: 'button', className: 'dsh-rs-trigger', 'data-rail': !props.wide,
      title, 'aria-label': title, 'aria-haspopup': 'dialog', 'aria-expanded': open,
      'aria-controls': DIALOG_ID, onClick: props.showPopup,
    }, h(ListIcon), props.wide ? h('span', null, props.t('trigger')) : null,
    h('span', { className: 'dsh-rs-count', 'data-active': rows.some(row => row.active), 'aria-hidden': true }, rows.length)));
  }
  function TaskRow(props) {
    const { row } = props;
    const ref = React.useRef(null);
    React.useEffect(() => {
      if (!row.needsOutcome) return;
      const node = ref.current;
      if (typeof IntersectionObserver !== 'function') { void props.ensureOutcome(row.id); return; }
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        void props.ensureOutcome(row.id);
      }, { root: props.scrollRef.current, rootMargin: '80px' });
      observer.observe(node);
      return () => observer.disconnect();
    }, [row.id, row.needsOutcome, props.ensureOutcome, props.scrollRef]);
    const title = row.title || props.t('untitled');
    const status = props.t(row.newCompletion ? 'newlyCompleted' : row.phase);
    return h('li', { ref }, h('button', {
      type: 'button', className: 'dsh-rs-row', title: [title, status, row.cwd].filter(Boolean).join('\n'),
      'aria-label': `${title} · ${status}`, 'aria-current': props.current === row.id && props.panel === null ? 'page' : undefined,
      onClick() {
        props.onOpenFailed(false);
        try { props.openSession(row.id); props.hidePopup(); }
        catch (cause) { console.error('[task-list] Navigation failed', cause); props.onOpenFailed(true); }
      },
    }, h('span', { className: row.phase === 'running' || row.phase === 'children' ? 'dsh-rs-spinner' : 'dsh-rs-dot', 'data-phase': row.phase, 'data-new-completion': row.newCompletion, 'aria-hidden': true }),
    h('span', { className: 'dsh-rs-copy' }, h('span', { className: 'dsh-rs-title' }, title),
      row.cwd ? h('span', { className: 'dsh-rs-directory' }, directoryLabel(row.cwd)) : null),
    h('span', { className: 'dsh-rs-status', 'data-phase': row.phase, 'data-new-completion': row.newCompletion, 'aria-hidden': true }, status)));
  }
  function Dialog(props) {
    const rows = useRows(props);
    const current = props.useSessions(currentSessionId);
    const phase = props.useSessions(value => value.phase);
    const panel = props.usePanelInfo(value => value.activePanelId);
    const ref = React.useRef(null);
    const scrollRef = React.useRef(null);
    const [error, setError] = React.useState(false);
    React.useEffect(() => {
      const dialog = ref.current;
      // Native modality supplies background inertness, focus containment, Escape,
      // and focus restoration. This touches our own ref only, never host DOM.
      dialog.showModal();
      return () => { if (dialog.open) dialog.close(); };
    }, []);
    const titleId = `${DIALOG_ID}-title`;
    const subtitleId = `${DIALOG_ID}-subtitle`;
    return h('dialog', {
      id: DIALOG_ID, ref, className: 'dsh-rs-dialog', 'aria-modal': true,
      'aria-labelledby': titleId, 'aria-describedby': subtitleId,
      onCancel(event) { event.preventDefault(); props.hidePopup(); },
      onClose: props.hidePopup,
      onClick(event) {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) props.hidePopup();
      },
    }, h('style', null, css), h('div', { className: 'dsh-rs-content' },
      h('div', { className: 'dsh-rs-header' },
        h('div', { className: 'dsh-rs-heading' },
          h('div', { className: 'dsh-rs-heading-line' }, h('h2', { id: titleId }, props.t('title')),
            h('span', { className: 'dsh-rs-count', 'data-active': rows.some(row => row.active), 'aria-label': props.t('count', { count: rows.length }), 'aria-live': 'polite', 'aria-atomic': true }, rows.length)),
          h('p', { id: subtitleId, className: 'dsh-rs-subtitle' }, props.t('subtitle'))),
        h('button', { type: 'button', className: 'dsh-rs-close', title: props.t('close'), 'aria-label': props.t('close'), onClick: props.hidePopup, autoFocus: true }, h(CloseIcon))),
      rows.length ? h('ul', { className: 'dsh-rs-list', ref: scrollRef }, rows.map(row => h(TaskRow, {
        ...props, key: row.id, row, current, panel, scrollRef, onOpenFailed: setError,
      }))) : h('p', { className: 'dsh-rs-empty' }, props.t(phase === 'pending' ? 'loading' : 'empty')),
      error ? h('p', { className: 'dsh-rs-error', role: 'alert' }, props.t('openError')) : null));
  }
  function Overlay(props) {
    const open = props.usePopup(value => value.open);
    return open ? h(Dialog, props) : null;
  }

  return {
    inject: ['slots', 'locale', 'uiWorkspace', 'sessions'],
    apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'en', en), 'running-sessions: English');
      ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'running-sessions: Chinese');
      const popup = createPopupState();
      const completionTrackingStartedAt = Date.now();
      ctx.effect(() => () => popup.dispose(), 'task-list: popup state');
      const outcomes = createOutcomeLoader(id => ctx.sessions.refreshProjections(id));
      ctx.effect(() => () => outcomes.dispose(), 'task-list: cold-safe outcome reads');
      const inject = () => ({
        hooks: { popup },
        completionTrackingStartedAt,
        showPopup: () => popup.show(), hidePopup: () => popup.hide(),
        openSession: id => ctx.uiWorkspace.openSession(id),
        ensureOutcome: id => outcomes.request(id),
      });
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action', id: 'local-task-list-new-completion-trigger', order: -10,
        locale: NS, label: () => ctx.locale.bind(NS)('title'), inject,
      }, Trigger));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'local-task-list-new-completion-modal', order: 50,
        locale: NS, inject,
      }, Overlay));
    },
  };
}

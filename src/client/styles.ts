export const styles = String.raw`
.ms-root {
  --ms-bg: #ffffff;
  --ms-header: #eef5fc;
  --ms-subtle: #f5f8fc;
  --ms-hover: #e7f0f9;
  --ms-text: #1a2735;
  --ms-heading: #132031;
  --ms-muted: #687b8f;
  --ms-line: #d9e4ef;
  --ms-accent: #3974a8;
  --ms-accent-strong: #285f90;
  --ms-on-accent: #ffffff;
  --ms-focus: #69a2d2;
  --ms-danger: #b44c55;
  --ms-danger-soft: #fff2f3;
  --ms-shadow: rgba(38, 66, 91, .18);
  color: var(--ms-text);
  color-scheme: light;
  font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif;
  font-size: 13px;
  line-height: 1.55;
  box-sizing: border-box;
  scrollbar-color: var(--ms-line) transparent;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-ms-theme="light"]) .ms-root {
    --ms-bg: #121212;
    --ms-header: #080808;
    --ms-subtle: #191919;
    --ms-hover: #292929;
    --ms-text: #ededeb;
    --ms-heading: #ffffff;
    --ms-muted: #a3a3a3;
    --ms-line: #303030;
    --ms-accent: #f2f2ef;
    --ms-accent-strong: #ffffff;
    --ms-on-accent: #111111;
    --ms-focus: #ffffff;
    --ms-danger: #ef9ba1;
    --ms-danger-soft: #2d1d1f;
    --ms-shadow: rgba(0, 0, 0, .7);
    color-scheme: dark;
  }
}
:root[data-ms-theme="dark"] .ms-root {
  --ms-bg: #121212;
  --ms-header: #080808;
  --ms-subtle: #191919;
  --ms-hover: #292929;
  --ms-text: #ededeb;
  --ms-heading: #ffffff;
  --ms-muted: #a3a3a3;
  --ms-line: #303030;
  --ms-accent: #f2f2ef;
  --ms-accent-strong: #ffffff;
  --ms-on-accent: #111111;
  --ms-focus: #ffffff;
  --ms-danger: #ef9ba1;
  --ms-danger-soft: #2d1d1f;
  --ms-shadow: rgba(0, 0, 0, .7);
  color-scheme: dark;
}
:root[data-ms-theme="light"] .ms-root {
  --ms-bg: #ffffff;
  --ms-header: #eef5fc;
  --ms-subtle: #f5f8fc;
  --ms-hover: #e7f0f9;
  --ms-text: #1a2735;
  --ms-heading: #132031;
  --ms-muted: #687b8f;
  --ms-line: #d9e4ef;
  --ms-accent: #3974a8;
  --ms-accent-strong: #285f90;
  --ms-on-accent: #ffffff;
  --ms-focus: #69a2d2;
  --ms-danger: #b44c55;
  --ms-danger-soft: #fff2f3;
  --ms-shadow: rgba(38, 66, 91, .18);
  color-scheme: light;
}
.ms-root *, .ms-root *::before, .ms-root *::after { box-sizing: border-box; }
.ms-root button, .ms-root input, .ms-root select, .ms-root textarea { font: inherit; }
.ms-root button { cursor: pointer; }
.ms-root button:focus-visible, .ms-root input:focus-visible, .ms-root select:focus-visible, .ms-root textarea:focus-visible, .ms-root a:focus-visible {
  outline: 2px solid var(--ms-focus);
  outline-offset: 2px;
}
.ms-root button:disabled { opacity: .45; cursor: not-allowed; }
.ms-root input::placeholder, .ms-root textarea::placeholder { color: var(--ms-muted); opacity: .8; }

.ms-float {
  position: fixed;
  z-index: 2147483000;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  width: min(580px, calc(100vw - 32px));
  max-height: calc(100vh - 88px);
  background: var(--ms-bg);
  border: 1px solid var(--ms-line);
  border-radius: 14px;
  box-shadow: 0 24px 64px var(--ms-shadow);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: ms-enter .18s ease-out;
}
.ms-float.ms-expanded {
  width: min(880px, calc(100vw - 32px));
  height: min(740px, calc(100vh - 56px));
  height: min(740px, calc(100dvh - 56px));
  top: 28px;
  max-height: none;
  min-height: 0;
}
.ms-float.ms-minimized { width: min(500px, calc(100vw - 32px)); max-height: 54px; border-radius: 12px; }
.ms-minimized .ms-header { height: 52px; }
.ms-minimized .ms-brand { max-width: 190px; }
.ms-minimized .ms-brand > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-panel { height: 100%; min-height: 360px; background: var(--ms-bg); display: flex; flex-direction: column; overflow: hidden; }
.ms-settings { max-width: 780px; margin: 0 auto; padding: 26px 28px 32px; background: var(--ms-bg); color: var(--ms-text); }
.ms-settings-heading { margin-bottom: 22px; }
.ms-settings-heading h2 { margin: 0 0 5px; color: var(--ms-heading); font-size: 21px; font-weight: 650; letter-spacing: -.02em; }
.ms-settings-heading p { margin: 0; color: var(--ms-muted); font-size: 12px; }
.ms-model-state { display: inline-flex; align-items: center; gap: 7px; color: var(--ms-muted); font-size: 12px; font-weight: 550; white-space: nowrap; }
.ms-model-state::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--ms-muted); flex: none; }
.ms-model-state.is-ready { color: var(--ms-heading); }
.ms-model-state.is-ready::before { background: #3ba877; box-shadow: 0 0 0 3px color-mix(in srgb, #3ba877 14%, transparent); }

.ms-header {
  height: 56px;
  flex: none;
  background: var(--ms-header);
  color: var(--ms-heading);
  display: flex;
  align-items: center;
  padding: 0 15px;
  gap: 9px;
  border-bottom: 1px solid var(--ms-line);
}
.ms-brand { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 650; letter-spacing: -.01em; min-width: 0; color: inherit; }
.ms-header .ms-brand { flex: 0 1 auto; }
.ms-header .ms-brand > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-header-actions { display: flex; align-items: center; gap: 2px; flex: none; }
.ms-header-divider { width: 1px; height: 18px; background: var(--ms-line); margin: 0 5px; flex: none; }
.ms-restore { border: 0; background: transparent; padding: 0; text-align: left; }
.ms-mark { display: inline-flex; align-items: center; justify-content: center; gap: 2px; width: 25px; height: 25px; background: var(--ms-accent); border-radius: 7px; flex: none; }
.ms-mark i { display: block; width: 2px; background: var(--ms-on-accent); border-radius: 2px; }
.ms-mark i:nth-child(1) { height: 6px; }
.ms-mark i:nth-child(2) { height: 13px; }
.ms-mark i:nth-child(3) { height: 9px; }
.ms-mark i:nth-child(4) { height: 5px; }
.ms-open-button { color: var(--ms-muted); }
.ms-open-button .ms-mark { background: transparent; }
.ms-open-button .ms-mark i { background: currentColor; }
.ms-live { width: 8px; height: 8px; border-radius: 50%; background: var(--ms-muted); opacity: .65; margin: 0 3px; flex: none; }
.ms-live.is-live { background: #3ba877; opacity: 1; box-shadow: 0 0 0 3px color-mix(in srgb, #3ba877 18%, transparent); }
.ms-live.is-ready { background: #4b9c78; opacity: 1; }
.ms-live.is-busy { background: #c7933f; opacity: 1; animation: ms-pulse 1.2s infinite; }
.ms-live.is-paused { background: var(--ms-muted); opacity: .65; }
.ms-spacer { flex: 1; }
.ms-icon { border: 0; background: transparent; color: var(--ms-muted); width: 30px; height: 30px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; padding: 0; flex: none; }
.ms-icon:hover { background: var(--ms-hover); color: var(--ms-heading); }
.ms-icon.ms-record-control { background: var(--ms-accent); color: var(--ms-on-accent); }
.ms-icon.ms-record-control:hover { background: var(--ms-accent-strong); color: var(--ms-on-accent); }
.ms-icon.ms-clear-control:hover { color: var(--ms-danger); background: var(--ms-danger-soft); }
.ms-icon[aria-busy="true"] svg { animation: ms-pulse .8s infinite; }
.ms-icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.ms-text-button { border: 0; background: transparent; color: var(--ms-accent-strong); padding: 2px 0; font-size: 11px; }
.ms-text-button:hover { text-decoration: underline; text-underline-offset: 3px; }

.ms-speakers { display: flex; align-items: center; gap: 7px; padding: 10px 16px; border-bottom: 1px solid var(--ms-line); background: var(--ms-subtle); overflow-x: auto; flex: none; min-height: 47px; }
.ms-speaker { border: 1px solid var(--ms-line); border-radius: 16px; background: var(--ms-bg); padding: 4px 10px 4px 7px; display: flex; align-items: center; gap: 7px; white-space: nowrap; color: var(--ms-text); font-size: 12px; }
.ms-speaker::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--speaker, var(--ms-muted)); }
.ms-speaker:hover { border-color: var(--ms-muted); }
.ms-speakers-empty { color: var(--ms-muted); font-size: 12px; }
.ms-speaker-input { width: 110px; border: 0; border-bottom: 1px solid var(--ms-accent); padding: 3px 2px; color: var(--ms-text); background: var(--ms-bg); outline: 0; }

.ms-recording-status { display: flex; align-items: center; gap: 13px; min-height: 54px; padding: 8px 18px; border-bottom: 1px solid var(--ms-line); background: var(--ms-subtle); flex: none; }
.ms-voice-wave { display: flex; align-items: center; gap: 4px; width: 119px; height: 34px; flex: none; }
.ms-voice-wave i { display: block; width: 3px; min-height: 4px; max-height: 34px; border-radius: 2px; background: var(--ms-line); transition: height 70ms linear, background-color 120ms ease; }
.ms-recording-status.has-sound .ms-voice-wave i { background: var(--ms-accent); }
.ms-recording-status .ms-time { text-align: right; }
.ms-transcript { padding: 13px 20px 18px; overflow-y: auto; flex: 1; min-height: 156px; scroll-behavior: smooth; background: var(--ms-bg); }
.ms-expanded .ms-transcript { min-height: 0; }
.ms-transcript-tools { justify-content: space-between; margin-bottom: 13px; color: var(--ms-muted); font-size: 11px; }
.ms-empty { height: 100%; min-height: 150px; display: flex; align-items: center; justify-content: center; flex-direction: column; text-align: center; color: var(--ms-muted); gap: 7px; padding: 24px; }
.ms-empty strong { font-weight: 600; color: var(--ms-heading); }
.ms-empty small { max-width: 320px; line-height: 1.7; }
.ms-segment { display: grid; grid-template-columns: 78px 1fr; gap: 15px; margin: 0 0 17px; }
.ms-segment-meta { padding-top: 1px; min-width: 0; }
.ms-segment-name { display: block; font-weight: 600; font-size: 12px; color: var(--ms-heading); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ms-segment-time { display: block; color: var(--ms-muted); font-size: 10px; margin-top: 2px; font-variant-numeric: tabular-nums; }
.ms-segment-text { margin: 0; padding-left: 15px; border-left: 1px solid var(--ms-line); line-height: 1.8; white-space: pre-wrap; word-break: break-word; color: var(--ms-text); }
.ms-segment-select { border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer; font: inherit; color: inherit; width: 100%; }
.ms-segment-select:hover { color: var(--ms-accent-strong); }
.ms-segment-select option { background: var(--ms-bg); color: var(--ms-text); }
.ms-pending { color: var(--ms-muted); margin: 0; padding-left: 108px; min-height: 24px; line-height: 1.8; }
.ms-pending::after { content: ""; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--ms-accent); margin-left: 7px; animation: ms-pulse 1.2s infinite; }

.ms-notebar { display: flex; gap: 9px; padding: 0 18px 11px; background: var(--ms-bg); }
.ms-notebar input { min-width: 0; flex: 1; border: 1px solid var(--ms-line); border-radius: 7px; padding: 7px 10px; color: var(--ms-text); background: var(--ms-subtle); }
.ms-notebar input:focus { background: var(--ms-bg); }
.ms-notebar button { border: 0; background: transparent; border-radius: 6px; padding: 0 8px; color: var(--ms-accent-strong); }
.ms-notebar button:hover { background: var(--ms-hover); }
.ms-time { font-size: 12px; color: var(--ms-muted); font-variant-numeric: tabular-nums; min-width: 42px; }
.ms-source { border: 1px solid var(--ms-line); border-radius: 7px; background: var(--ms-bg); color: var(--ms-text); padding: 5px 7px; font-size: 11px; max-width: 112px; }
.ms-action { border: 1px solid var(--ms-line); background: var(--ms-bg); color: var(--ms-text); border-radius: 7px; min-height: 34px; padding: 5px 11px; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.ms-action svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.ms-action:hover { border-color: var(--ms-accent); color: var(--ms-accent-strong); }
.ms-action.ms-primary { background: var(--ms-accent); color: var(--ms-on-accent); border-color: var(--ms-accent); }
.ms-action.ms-primary:hover { background: var(--ms-accent-strong); }
.ms-clear { color: var(--ms-muted); }
.ms-clear:hover { color: var(--ms-danger); border-color: var(--ms-danger); }

.ms-detail { flex: 1; min-height: 0; overflow: auto; padding: 18px 22px; background: var(--ms-subtle); }
.ms-detail-metadata { overflow: hidden; display: flex; }
.ms-section.ms-detail-form { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; margin: 0; }
.ms-section.ms-detail-form > h3 { flex: none; }
.ms-section.ms-detail-form .ms-fields { flex: 1; min-height: 0; overflow-y: auto; align-content: start; padding: 2px; scrollbar-gutter: stable; }
.ms-row.ms-detail-actions { flex: none; flex-wrap: nowrap; margin: 12px -2px -2px; padding: 12px 2px 2px; border-top: 1px solid var(--ms-line); background: var(--ms-bg); }
.ms-row.ms-detail-actions .ms-hint { flex: 1; }
.ms-tabs { display: flex; gap: 23px; border-bottom: 1px solid var(--ms-line); padding: 0 20px; flex: none; height: 43px; background: var(--ms-bg); }
.ms-tab { border: 0; background: transparent; color: var(--ms-muted); padding: 0 1px; position: relative; }
.ms-tab:hover { color: var(--ms-heading); }
.ms-tab.is-active { color: var(--ms-heading); font-weight: 600; }
.ms-tab.is-active::after { content: ""; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: var(--ms-accent); }
.ms-section { background: var(--ms-bg); border: 1px solid var(--ms-line); border-radius: 9px; padding: 17px; margin-bottom: 14px; }
.ms-section h3 { font-size: 13px; margin: 0 0 14px; color: var(--ms-heading); font-weight: 650; }
.ms-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 13px 15px; }
.ms-field { display: flex; flex-direction: column; gap: 5px; color: var(--ms-muted); font-size: 11px; }
.ms-field.ms-wide { grid-column: 1 / -1; }
.ms-field input, .ms-field select, .ms-field textarea, .ms-setting-row input[type="number"] { width: 100%; border: 1px solid var(--ms-line); border-radius: 6px; padding: 7px 9px; color: var(--ms-text); background: var(--ms-bg); }
.ms-field textarea { min-height: 74px; resize: vertical; }
.ms-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ms-hint { color: var(--ms-muted); font-size: 11px; line-height: 1.7; }
.ms-error { background: var(--ms-danger-soft); color: var(--ms-danger); border-left: 3px solid var(--ms-danger); padding: 8px 12px; margin: 8px 14px 0; font-size: 12px; }
.ms-notice { background: var(--ms-hover); color: var(--ms-accent-strong); border-left: 3px solid var(--ms-accent); padding: 8px 12px; margin: 8px 14px 0; font-size: 12px; }
.ms-file { display: flex; align-items: center; gap: 12px; border-top: 1px solid var(--ms-line); padding: 13px 0; }
.ms-file:first-child { border-top: 0; }
.ms-file-icon { width: 34px; height: 40px; border: 1px solid var(--ms-line); border-radius: 5px; color: var(--ms-accent-strong); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
.ms-file-info { flex: 1; }
.ms-file-info strong { display: block; font-weight: 550; color: var(--ms-heading); }
.ms-file-info small { color: var(--ms-muted); }
.ms-history-heading { margin-bottom: 12px; }
.ms-history-heading h3 { margin: 0; white-space: nowrap; }
.ms-history-heading .ms-hint { color: var(--ms-danger); }
.ms-history-item { display: flex; width: 100%; border: 0; border-bottom: 1px solid var(--ms-line); background: var(--ms-bg); color: var(--ms-text); padding: 13px 5px; text-align: left; gap: 10px; }
.ms-history-item:hover { background: var(--ms-hover); }
.ms-history-item strong { font-weight: 550; flex: 1; }
.ms-history-item small { color: var(--ms-muted); }

.ms-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 14px 0; border-bottom: 1px solid var(--ms-line); }
.ms-setting-row:last-child { border-bottom: 0; }
.ms-setting-copy strong { display: block; font-weight: 600; color: var(--ms-heading); margin-bottom: 3px; }
.ms-setting-copy small { display: block; color: var(--ms-muted); max-width: 500px; line-height: 1.65; }
.ms-setting-row input[type="range"] { accent-color: var(--ms-accent); }
.ms-switch { appearance: none; width: 36px; height: 20px; border-radius: 12px; background: var(--ms-line); position: relative; cursor: pointer; flex: none; margin: 0; }
.ms-switch:checked { background: var(--ms-accent); }
.ms-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--ms-bg); transition: left .15s; }
.ms-switch:checked::after { left: 19px; background: var(--ms-on-accent); }
.ms-progress { height: 4px; background: var(--ms-line); border-radius: 3px; overflow: hidden; margin-top: 10px; }
.ms-progress i { display: block; height: 100%; background: var(--ms-accent); }
.ms-directory-setting { margin-bottom: 9px; }
.ms-directory { width: 100%; display: flex; align-items: center; gap: 10px; border: 1px solid var(--ms-line); border-radius: 7px; background: var(--ms-subtle); color: var(--ms-text); padding: 10px 11px; text-align: left; }
.ms-directory:hover { background: var(--ms-hover); border-color: var(--ms-accent); }
.ms-directory svg { width: 18px; height: 18px; flex: none; fill: none; stroke: var(--ms-accent-strong); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.ms-directory span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; }
.ms-directory strong { margin-left: auto; padding-left: 14px; color: var(--ms-accent-strong); font-weight: 600; white-space: nowrap; }
.ms-vocabulary-copy { margin-bottom: 10px; }
.ms-vocabulary { box-sizing: border-box; width: 100%; min-height: 112px; resize: vertical; border: 1px solid var(--ms-line); border-radius: 7px; padding: 10px 12px; background: var(--ms-subtle); color: var(--ms-text); font: 12px/1.8 "Segoe UI", "Microsoft YaHei UI", sans-serif; }
.ms-vocabulary:focus { background: var(--ms-bg); border-color: var(--ms-accent); outline: 2px solid color-mix(in srgb, var(--ms-accent) 15%, transparent); }
.ms-vocabulary::placeholder { color: var(--ms-muted); opacity: .7; }
.ms-vocabulary-actions { justify-content: space-between; margin-top: 10px; }
.ms-vocabulary-actions .ms-hint { max-width: 560px; }

.ms-workspace { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--ms-subtle); }
.ms-workspace-header { height: 64px; flex: none; display: flex; align-items: stretch; gap: 42px; padding: 0 clamp(20px, 4vw, 48px); border-bottom: 1px solid var(--ms-line); background: var(--ms-bg); }
.ms-workspace-brand { display: flex; align-items: center; gap: 11px; min-width: 190px; }
.ms-workspace-brand .ms-mark { width: 32px; height: 32px; border-radius: 9px; }
.ms-workspace-brand > span { display: flex; flex-direction: column; line-height: 1.35; }
.ms-workspace-brand strong { color: var(--ms-heading); font-size: 15px; font-weight: 650; letter-spacing: -.01em; }
.ms-workspace-brand small { color: var(--ms-muted); font-size: 10px; }
.ms-workspace-nav { display: flex; align-items: stretch; gap: 26px; }
.ms-workspace-nav button { position: relative; display: inline-flex; align-items: center; gap: 7px; border: 0; padding: 0 2px; background: transparent; color: var(--ms-muted); font-size: 13px; }
.ms-workspace-nav button:hover { color: var(--ms-heading); }
.ms-workspace-nav button.is-active { color: var(--ms-heading); font-weight: 600; }
.ms-workspace-nav button.is-active::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--ms-accent); }
.ms-workspace-nav svg, .ms-documents-heading .ms-action svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.ms-workspace-content { flex: 1; min-height: 0; overflow: auto; padding: 30px clamp(20px, 4vw, 48px) 36px; }
.ms-documents { width: 100%; max-width: 1180px; margin: 0 auto; }
.ms-documents-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.ms-documents-heading h1 { margin: 0 0 5px; color: var(--ms-heading); font-size: 24px; line-height: 1.3; font-weight: 650; letter-spacing: -.025em; }
.ms-documents-heading p { margin: 0; color: var(--ms-muted); font-size: 12px; }
.ms-document-tools { display: flex; align-items: center; gap: 10px; margin: 24px 0 12px; }
.ms-document-search { height: 38px; min-width: 180px; flex: 1; display: flex; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid var(--ms-line); border-radius: 7px; background: var(--ms-bg); color: var(--ms-muted); }
.ms-document-search:focus-within { border-color: var(--ms-accent); outline: 2px solid color-mix(in srgb, var(--ms-accent) 15%, transparent); }
.ms-document-search svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.ms-document-search input { width: 100%; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--ms-text); }
.ms-document-search input:focus-visible { outline: 0; }
.ms-document-tools select { height: 38px; min-width: 158px; border: 1px solid var(--ms-line); border-radius: 7px; padding: 0 30px 0 11px; background: var(--ms-bg); color: var(--ms-text); }
.ms-workspace .ms-document-refresh { width: 38px; height: 38px; border: 1px solid var(--ms-line); border-radius: 7px; background: var(--ms-bg); }
.ms-document-list { overflow: hidden; border: 1px solid var(--ms-line); border-radius: 10px; background: var(--ms-bg); }
.ms-document-list-head, .ms-document-row { display: grid; grid-template-columns: minmax(0, 1fr) 76px 170px 82px; align-items: center; gap: 16px; padding: 0 18px; }
.ms-document-list-head { min-height: 38px; border-bottom: 1px solid var(--ms-line); background: var(--ms-subtle); color: var(--ms-muted); font-size: 11px; }
.ms-document-list ul { margin: 0; padding: 0; list-style: none; }
.ms-document-row { min-height: 76px; border-bottom: 1px solid var(--ms-line); }
.ms-document-row:last-child { border-bottom: 0; }
.ms-document-row:hover { background: color-mix(in srgb, var(--ms-hover) 48%, var(--ms-bg)); }
.ms-document-name { min-width: 0; display: flex; align-items: center; gap: 12px; }
.ms-document-name > span:last-child { min-width: 0; }
.ms-document-name strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ms-heading); font-size: 13px; font-weight: 600; }
.ms-document-name small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; color: var(--ms-muted); font-size: 11px; }
.ms-document-version, .ms-document-time { color: var(--ms-muted); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ms-document-download { min-height: 32px; justify-self: end; padding: 4px 9px; text-decoration: none; font-size: 12px; }
.ms-document-download svg { width: 14px; height: 14px; }
.ms-documents-empty { min-height: 360px; }
.ms-documents-empty > svg { width: 32px; height: 32px; margin-bottom: 6px; fill: none; stroke: var(--ms-muted); stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.ms-documents-empty .ms-action { margin-top: 10px; }
.ms-documents-footer { display: flex; justify-content: space-between; gap: 20px; padding: 12px 2px; color: var(--ms-muted); font-size: 11px; }
.ms-workspace-settings { flex: 1; min-height: 0; overflow: auto; background: var(--ms-subtle); }
.ms-workspace-settings .ms-settings { max-width: 920px; background: transparent; padding: 28px 32px 40px; }

@keyframes ms-enter { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes ms-pulse { 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) {
  .ms-root * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
@media (max-width: 600px) {
  .ms-float { top: 12px; max-height: calc(100vh - 24px); }
  .ms-float.ms-expanded { top: 8px; height: calc(100vh - 16px); width: calc(100vw - 16px); }
  .ms-float.ms-minimized { top: 12px; max-height: 54px; }
  .ms-source { max-width: 88px; }
  .ms-action { padding: 5px 8px; }
  .ms-recording-status { padding-left: 12px; padding-right: 12px; gap: 9px; }
  .ms-voice-wave { width: 95px; gap: 3px; }
  .ms-detail-actions .ms-hint { display: none; }
  .ms-fields { grid-template-columns: 1fr; }
  .ms-segment { grid-template-columns: 64px 1fr; gap: 9px; }
  .ms-segment-text { padding-left: 10px; }
  .ms-pending { padding-left: 83px; }
  .ms-detail { padding: 12px; }
  .ms-settings { padding: 20px 16px; }
  .ms-setting-row { gap: 14px; }
  .ms-directory strong { padding-left: 8px; }
}
@media (max-width: 700px) {
  .ms-workspace-header { height: 58px; gap: 24px; padding: 0 16px; }
  .ms-workspace-brand { min-width: 0; }
  .ms-workspace-brand small { display: none; }
  .ms-workspace-nav { gap: 16px; }
  .ms-workspace-nav button { font-size: 12px; }
  .ms-workspace-content { padding: 20px 14px 26px; }
  .ms-documents-heading { align-items: flex-start; gap: 12px; }
  .ms-documents-heading h1 { font-size: 21px; }
  .ms-documents-heading .ms-action { padding: 5px 8px; }
  .ms-document-tools { flex-wrap: wrap; margin-top: 18px; }
  .ms-document-search { flex-basis: 100%; }
  .ms-document-tools select { flex: 1; min-width: 0; }
  .ms-document-list-head { display: none; }
  .ms-document-row { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 13px 14px; }
  .ms-document-name { grid-column: 1; grid-row: 1; }
  .ms-document-version { display: none; }
  .ms-document-time { grid-column: 1; grid-row: 2; margin-left: 46px; }
  .ms-document-download { grid-column: 2; grid-row: 1 / span 2; }
  .ms-documents-footer > span { display: none; }
  .ms-workspace-settings .ms-settings { padding: 20px 14px 30px; }
}
@media (max-width: 420px) {
  .ms-workspace-header { gap: 14px; padding: 0 12px; }
  .ms-workspace-brand > span { display: none; }
  .ms-workspace-nav { flex: 1; gap: 12px; }
  .ms-workspace-nav button { font-size: 11px; }
  .ms-documents-heading p { max-width: 180px; }
  .ms-documents-heading .ms-action { font-size: 11px; }
  .ms-document-download span { display: none; }
  .ms-document-download { width: 32px; padding: 4px; }
  .ms-document-time { font-size: 10px; }
}
`

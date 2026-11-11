import { icon } from "./icons";
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export function taskAdvanced(prefix: string): string {
  return '<details class="advanced-panel task-advanced" id="'+prefix+'-advanced"><summary>'+icon('sliders')+'<span>高级选项</span>'+icon('chevDown')+'</summary><div class="advanced-body"><label class="advanced-toggle"><input type="checkbox" id="'+prefix+'-verify"><span>校验文件<span class="field-help">下载完成后，与发布者提供的校验值核对。</span></span></label><div class="form-field" id="'+prefix+'-verification" hidden><label for="'+prefix+'-checksum">SHA-256 校验值</label><input class="form-input checksum-input" id="'+prefix+'-checksum" maxlength="64" autocomplete="off" spellcheck="false" placeholder="输入 64 位十六进制校验值" disabled><p class="field-help">没有发布者提供的校验值时，无需开启。</p><p class="field-error" id="'+prefix+'-checksum-error" role="alert" hidden></p></div></div></details>';
}
export function bindTaskAdvanced(prefix: string) {
  const toggle = element<HTMLInputElement>(prefix+'-verify');
  toggle.addEventListener('change', () => {
    element(prefix+'-verification').hidden = !toggle.checked;
    element<HTMLInputElement>(prefix+'-checksum').disabled = !toggle.checked;
    if (!toggle.checked) { element<HTMLInputElement>(prefix+'-checksum').value = ''; element(prefix+'-checksum-error').hidden = true; }
  });
  element<HTMLInputElement>(prefix+'-checksum').addEventListener('input', () => {
    element(prefix+'-checksum-error').hidden = true;
    element(prefix+'-checksum').removeAttribute('aria-invalid');
  });
}
export function resetTaskAdvanced(prefix: string) {
  element<HTMLDetailsElement>(prefix+'-advanced').open = false;
  element<HTMLInputElement>(prefix+'-verify').checked = false;
  element(prefix+'-verification').hidden = true;
  const input = element<HTMLInputElement>(prefix+'-checksum'); input.value = ''; input.disabled = true; input.removeAttribute('aria-invalid');
  element(prefix+'-checksum-error').hidden = true;
}
export function readTaskChecksum(prefix: string): string | null | undefined {
  if (!element<HTMLInputElement>(prefix+'-verify').checked) return null;
  const input = element<HTMLInputElement>(prefix+'-checksum');
  const value = input.value.trim();
  const valid = /^[a-fA-F0-9]{64}$/.test(value);
  const error = element(prefix+'-checksum-error'); error.hidden = valid;
  input.setAttribute('aria-invalid', String(!valid));
  if (!valid) { element<HTMLDetailsElement>(prefix+'-advanced').open = true; error.textContent = '请输入完整的 64 位十六进制 SHA-256 校验值。'; input.focus(); return undefined; }
  return value;
}

/**
 * Download and Import for Library items (browser view).
 * Download asks the licence ("Anyone may use this (CC0)" / "Keep my rights",
 * written into the GLB's asset.copyright) and the file: a 3D model (.glb) for
 * game engines, or a ClayMind project (.claymind.json) to import again.
 * Import: the Library's Import button (file picker) or dropping a
 * .claymind.json file on the page. In the headset there is no file dialog: a
 * toast says to use the browser view.
 */
import { createSystem } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { settings } from '../core/settings.js';
import { exportGlb, Licence } from '../export/glb.js';
import { downloadFile, fileBase, ImportError, MAX_IMPORT_BYTES, projectFromJson, projectToJson } from '../export/project-file.js';
import { input } from '../platform/input/input-system.js';
import type { SavedCreation } from '../storage/library.js';
import { LibrarySystem } from './library.js';

export class DownloadSystem extends createSystem({}) {
  private dialog: HTMLDivElement | null = null;

  init(): void {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      void this.importFile(file);
    };
    addEventListener('dragover', onDragOver);
    addEventListener('drop', onDrop);
    this.cleanupFuncs.push(
      bus.on('library:download', (e) => this.open(e.item)),
      bus.on('library:import', () => this.pick()),
      () => removeEventListener('dragover', onDragOver),
      () => removeEventListener('drop', onDrop),
      () => this.close(),
    );
  }

  private pick(): void {
    if (input.xr) return void bus.emit('ui:toast', { text: 'Import works in the browser view (no file picker in the headset)' });
    const f = document.createElement('input');
    f.type = 'file';
    f.accept = '.json,application/json';
    f.onchange = () => f.files?.[0] && void this.importFile(f.files[0]);
    f.click();
  }

  async importFile(file: File): Promise<void> {
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new ImportError('File too large (over 10 MB)');
      if (!/\.json$/i.test(file.name)) throw new ImportError('Only ClayMind project files (.claymind.json) can be imported');
      const item = projectFromJson(await file.text());
      await this.world.getSystem(LibrarySystem)!.addItem(item);
      bus.emit('ui:toast', { text: `Imported "${item.creation.name}" into the Library` });
    } catch (e) {
      bus.emit('ui:toast', { text: e instanceof ImportError ? `Import refused: ${e.message}` : 'Import failed', color: '#d9534f' });
    }
  }

  private open(item: SavedCreation): void {
    if (input.xr) return void bus.emit('ui:toast', { text: 'Download works in the browser view: exit, then Library -> Download' });
    this.close();
    const hc = settings.highContrast;
    const d = (this.dialog = document.createElement('div'));
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Download');
    Object.assign(d.style, {
      position: 'fixed', inset: '0', display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.45)', zIndex: '20',
      font: '500 15px system-ui, sans-serif', color: '#fff',
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      width: 'min(420px, calc(100vw - 32px))', padding: '20px', borderRadius: '16px', background: hc ? '#000' : '#1d2026',
      outline: hc ? '2px solid #fff' : 'none', display: 'grid', gap: '12px', boxSizing: 'border-box',
    });
    // keep the dialog's clicks to itself: a page-level handler further up cancels clicks, which would stop the radio buttons
    box.addEventListener('click', (e) => e.stopPropagation());
    const title = document.createElement('div');
    title.textContent = `Download "${item.creation.name}"`;
    title.style.font = '700 18px system-ui, sans-serif';
    box.appendChild(title);
    const licences: [Licence, string][] = [['reserved', 'Keep my rights (no licence added)'], ['cc0', 'Anyone may use this (CC0)']];
    for (const [value, label] of licences) {
      const row = document.createElement('label');
      Object.assign(row.style, { display: 'flex', gap: '10px', alignItems: 'center', minHeight: '40px', cursor: 'pointer' });
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'claymind-licence';
      r.value = value;
      r.checked = value === 'reserved';
      r.style.width = r.style.height = '20px';
      row.append(r, label);
      box.appendChild(row);
    }
    const licence = () => (box.querySelector('input[name="claymind-licence"]:checked') as HTMLInputElement).value as Licence;
    const btn = (label: string, primary: boolean, onClick: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        minHeight: '48px', border: '0', borderRadius: '12px', cursor: 'pointer', font: '700 15px system-ui, sans-serif',
        background: primary ? '#f0b429' : hc ? '#222' : 'rgba(255,255,255,0.12)', color: primary ? '#111' : '#fff',
        outline: hc ? '1px solid #fff' : 'none',
      });
      b.onclick = onClick;
      box.appendChild(b);
      return b;
    };
    const base = fileBase(item.creation.name);
    const glbBtn = btn('3D model for games (.glb)', true, () => {
      glbBtn.disabled = true;
      glbBtn.textContent = 'Preparing…';
      void exportGlb(item, licence())
        .then((bytes) => {
          downloadFile(`${base}.glb`, bytes, 'model/gltf-binary');
          bus.emit('ui:toast', { text: `Downloaded ${base}.glb` });
          this.close();
        })
        .catch(() => {
          bus.emit('ui:toast', { text: 'Export failed', color: '#d9534f' });
          this.close();
        });
    });
    btn('ClayMind project (.claymind.json)', false, () => {
      downloadFile(`${base}.claymind.json`, projectToJson(item), 'application/json');
      bus.emit('ui:toast', { text: `Downloaded ${base}.claymind.json` });
      this.close();
    });
    btn('Cancel', false, () => this.close());
    d.appendChild(box);
    d.onclick = (e) => e.target === d && this.close();
    document.body.appendChild(d);
    glbBtn.focus();
  }

  private close(): void {
    this.dialog?.remove();
    this.dialog = null;
  }
}

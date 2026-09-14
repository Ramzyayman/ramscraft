import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

// Same look as the page-level modals (Software install, Backups restore/delete).
const TONES = {
    danger: { border: 'border-red-500/30', text: 'text-red-400', button: 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/30' },
    warning: { border: 'border-orange-500/30', text: 'text-orange-400', button: 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border-orange-500/30' },
    info: { border: 'border-blue-500/30', text: 'text-blue-400', button: 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border-blue-500/30' },
};

export interface DialogOptions {
    title: string;
    message?: ReactNode;
    confirmLabel: string;
    tone?: keyof typeof TONES;
    /** Show a text field; the dialog then resolves to its value. */
    input?: { defaultValue?: string; placeholder?: string };
}

type Pending = DialogOptions & { resolve: (value: string | null) => void };

/**
 * In-app replacement for window.confirm / window.prompt.
 *   const { dialog, confirm, prompt } = useDialog();
 *   if (!(await confirm({ title, message, confirmLabel, tone: 'danger' }))) return;
 * Render `{dialog}` once in the page.
 */
export function useDialog() {
    const [pending, setPending] = useState<Pending | null>(null);

    const open = (options: DialogOptions) => new Promise<string | null>(resolve => setPending({ ...options, resolve }));
    const close = (value: string | null) => {
        pending?.resolve(value);
        setPending(null);
    };

    return {
        dialog: pending && <DialogView pending={pending} onClose={close} />,
        confirm: (options: DialogOptions) => open(options).then(v => v !== null),
        prompt: (options: DialogOptions) => open({ ...options, input: options.input ?? {} }),
    };
}

const DialogView = ({ pending, onClose }: { pending: Pending; onClose: (value: string | null) => void }) => {
    const tone = TONES[pending.tone ?? 'info'];
    const [value, setValue] = useState(pending.input?.defaultValue ?? '');

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const submit = () => {
        if (pending.input && !value.trim()) return;
        onClose(pending.input ? value.trim() : '');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => onClose(null)}>
            <div role="dialog" aria-modal="true" aria-labelledby="rc-dialog-title"
                className={`glass-panel w-full max-w-md p-6 rounded-xl border ${tone.border} shadow-2xl`}
                onClick={e => e.stopPropagation()}>
                <div className={`flex items-center gap-3 mb-4 ${tone.text}`}>
                    <AlertTriangle size={24} />
                    <h3 id="rc-dialog-title" className="text-lg font-semibold">{pending.title}</h3>
                </div>
                {pending.message && <div className="text-sm text-slate-300 mb-6 leading-relaxed">{pending.message}</div>}
                {pending.input && (
                    <form onSubmit={e => { e.preventDefault(); submit(); }} className="mb-6">
                        <input autoFocus value={value} onChange={e => setValue(e.target.value)}
                            placeholder={pending.input.placeholder} className="w-full glass-input text-sm" />
                    </form>
                )}
                <div className="flex gap-3 justify-end">
                    <button onClick={() => onClose(null)} className="glass-button px-4 py-2 text-slate-300 hover:text-white">
                        Cancel
                    </button>
                    <button onClick={submit} autoFocus={!pending.input} disabled={!!pending.input && !value.trim()}
                        className={`glass-button px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${tone.button}`}>
                        {pending.confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

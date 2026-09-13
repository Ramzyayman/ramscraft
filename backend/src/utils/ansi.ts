// Strip ANSI colour/SGR codes and the terminal control sequences that tmux
// pipe-pane injects (CSI cursor moves, erase-line, bracketed-paste, private
// modes) plus OSC title sequences and stray carriage returns, so the web console
// shows clean text instead of raw escape codes.
const ESC = '\u001b';

// CSI: ESC [ ... final-byte
const CSI = new RegExp(ESC + '\\[[0-9;?!>=]*[ -/]*[@-~]', 'g');
// OSC: ESC ] ... (BEL or ESC \)
const OSC = new RegExp(ESC + '\\][^\u0007\u001b]*(?:\u0007|' + ESC + '\\\\)?', 'g');
// Other single-char escapes: ESC ( B, ESC =, ESC >, etc.
const SIMPLE = new RegExp(ESC + '[()#][0-9A-Za-z]|' + ESC + '[=>78Mc]', 'g');

export function stripAnsi(input: string): string {
    return input
        .replace(CSI, '')
        .replace(OSC, '')
        .replace(SIMPLE, '')
        .replace(/\r/g, '');
}

'use client';

import { useEffect, useRef } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Heading2, Italic, List, ListOrdered, Underline } from 'lucide-react';

type Command = { label: string; icon: typeof Bold; command: string; value?: string };

/**
 * The toolbar is exactly the formatting lib/documents/renderDocumentPdf can
 * draw — no more. Offering a control the PDF renderer cannot honour would
 * mean the document looked one way on screen and another on paper, which for
 * an official letter is worse than having fewer options.
 */
const COMMANDS: Command[] = [
  { label: 'Bold', icon: Bold, command: 'bold' },
  { label: 'Italic', icon: Italic, command: 'italic' },
  { label: 'Underline', icon: Underline, command: 'underline' },
  { label: 'Heading', icon: Heading2, command: 'formatBlock', value: 'h2' },
  { label: 'Bulleted list', icon: List, command: 'insertUnorderedList' },
  { label: 'Numbered list', icon: ListOrdered, command: 'insertOrderedList' },
  { label: 'Align left', icon: AlignLeft, command: 'justifyLeft' },
  { label: 'Align centre', icon: AlignCenter, command: 'justifyCenter' },
  { label: 'Align right', icon: AlignRight, command: 'justifyRight' },
];

export function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);

  // Only writes into the element when the incoming value genuinely differs
  // from what is already rendered. Assigning innerHTML on every keystroke
  // would move the caret to the start of the document on each character.
  useEffect(() => {
    const element = editorRef.current;
    if (element && element.innerHTML !== value) {
      element.innerHTML = value;
    }
  }, [value]);

  function run(command: Command) {
    const element = editorRef.current;
    if (!element) return;

    element.focus();
    // execCommand is deprecated but remains the only API every browser
    // implements for contenteditable formatting, and the alternative is a
    // large editor dependency for six buttons.
    document.execCommand(command.command, false, command.value);
    onChange(element.innerHTML);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border/70 bg-secondary/40 px-2 py-1.5">
        {COMMANDS.map((command) => (
          <button
            key={command.label}
            type="button"
            title={command.label}
            aria-label={command.label}
            // onMouseDown, not onClick: clicking a button blurs the editor
            // first, which collapses the selection the command needs.
            onMouseDown={(event) => {
              event.preventDefault();
              run(command);
            }}
            className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            data-testid={`button-format-${command.command}`}
          >
            <command.icon size={15} />
          </button>
        ))}
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Document body"
        onInput={(event) => onChange((event.target as HTMLDivElement).innerHTML)}
        onBlur={(event) => onChange((event.target as HTMLDivElement).innerHTML)}
        className="document-body min-h-[340px] overflow-y-auto bg-card px-6 py-5 text-sm leading-relaxed text-foreground outline-none"
        data-testid="editor-document-body"
      />
    </div>
  );
}

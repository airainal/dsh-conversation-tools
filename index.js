/**
 * Host half of the conversation-tools bundle.
 *
 * Every surface is browser chrome driven by the Client module: the file-link
 * context menu and the message editor call the existing Session Remote, and the
 * context-compaction button runs the existing `/compact` command. Nothing here
 * reaches the model request, so this half owns no Service, Event, or Tool.
 */
export function apply() {}

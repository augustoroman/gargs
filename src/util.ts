// Logger interfaces.

export interface Logger {
  debug(...args: any[]): void;
  info(...args: any[]): void;
  error(...args: any[]): void;
}
export const nullLogger: Logger = {
  debug: (): void => {},
  info: (): void => {},
  error: (): void => {},
};

/**
 * This Logger passes through to the underlying logger but also records any
 * error output to the errors array.
 */
export class RecordErrorsLogger implements Logger {
  public constructor(public parent: Logger, public errors: string[]) {}
  public debug(...args: any[]): void {
    this.parent.debug(...args);
  }
  public info(...args: any[]): void {
    this.parent.info(...args);
  }
  public error(...args: any[]): void {
    this.errors.push(args.join(' '));
    this.parent.error(...args);
  }
}

// Convert a string to camelCase.
// stacksort'd and adapted from:
// https://stackoverflow.com/questions/2970525/converting-any-string-into-camel-case
export function toCamelCase(str: string): string {
  return (
    str
      // Insert spaces before any existing uppercase letter. This prevents us
      // from ruining an existing camelCase string. This will not handle
      // incoming ALL-CAPS strings well, but that should be unlikely.
      .replace(/[A-Z]/g, ($1: string) => ` ${$1}`)
      // Lower cases the string
      .toLowerCase()
      // Replaces any - or _ characters with a space
      .replace(/[-_]+/g, ' ')
      // Removes any non alphanumeric characters
      .replace(/[^\w\s]/g, '')
      // Trim any leading/trailing whitespace.
      .trim()
      // Uppercases the first character in each group immediately following a space
      // (delimited by spaces)
      .replace(/ (.)/g, ($1: string) => $1.toUpperCase())
      // Removes spaces
      .replace(/ /g, '')
  );
}

/**
 * Helper function to convert a string to a boolean.
 */
export function parseBoolOrThrow(val: string): boolean {
  switch (val.toLowerCase()) {
    case '1':
    case 't':
    case 'true':
    case 'y':
    case 'yes':
      return true;
    case '0':
    case 'f':
    case 'false':
    case 'n':
    case 'no':
      return false;
    default:
      throw new Error(`cannot convert "${val}" to boolean.`);
  }
}

/**
 * Helper function to convert a string to a number.
 */
export function parseNumOrThrow(val: string): number {
  const num = Number(val);
  if (Number.isNaN(num)) {
    throw new Error(`cannot parse "${val}" as a number.`);
  }
  return num;
}

/**
 * Helper function to convert a string to an int.
 */
export function parseIntOrThrow(val: string): number {
  const num = parseNumOrThrow(val);
  if (num !== Math.floor(num)) {
    throw new Error(`cannot parse "${val}" as an integer.`);
  }
  return num;
}

// require('left-pad')
export function pad(str: string, width: number) {
  if (width <= str.length) {
    return str;
  }
  return str + ' '.repeat(width - str.length);
}

/**
 * align is a helper function to pad a bunch of strings so that the delimiter on
 * each line is lined up in the same column. This is a real simple
 * implementation to avoid additional dependencies (e.g. oclif.table).
 * @param lines the array of individual lines containing one or more delimiters.
 * @param opts options to control how the alignment is done
 * @param opts.delim the delimiter to align across each line.
 * @param opts.padding minimum space between each column
 * @param opts.min minimum column width
 */
export function align(
  lines: string[],
  opts?: { delim?: string; padding?: number; min?: number },
): string[] {
  const { delim = '\t', padding = 3, min = 20 } = opts || {};

  // TODO(aroman) Consider adding text-wrapping to wrap long lines. Probably
  // something like an optional `wrap = maxwidth` parameter. It should word-wrap
  // if possible, otherwise forcibly break the line at the max width if no word
  // break is found (e.g. code or ascii-art).

  // First, split all of the data into a grid of cells. In particular, this also
  // means splitting cells with newlines into new rols. That is, if we get:
  //    `col1 \t col2...\n...line2 \t col3`
  //                    ^^
  // then we should split it into these rows:
  //    [ 'col1 ' , ' col2...'  , ' col3' ]
  //    [ ''      , '...line2 ' , ''      ]
  // so that it will display nicely and not count multi-line cells as really
  // wide cells.
  //
  // NOTE that it's an explicit design decision to not trim whitespace from
  // cell values. This allows formatting a multi-line column value (e.g. with
  // indented lines) and forcing the min width for individual columns.
  const rows: string[][] = [];
  lines.forEach((line) => {
    const cols = line.split(delim);
    // Split each cell into a list of lines...
    const colLines = cols.map(cell => cell.split('\n'));
    // ...then shift out the first entry of those lines until each cell's list
    // is empty.
    while (colLines.some(c => c.length > 0)) {
      rows.push(colLines.map(col => col.shift() || ''));
    }
  });

  // Once we've cleanly split into rows of cells, it's easy to find the max
  // width of each column.
  const colWidths: { [i: number]: number } = {};
  rows.forEach((cols) => {
    cols.forEach((val, colIndex) => {
      colWidths[colIndex] = Math.max(val.length, colWidths[colIndex] || min);
    });
  });

  // Finally, join each row back up into a list of lines.
  return rows.map(cols =>
    cols
      .map((val, colIdx) => pad(val, colWidths[colIdx]))
      .join(' '.repeat(padding)));
}

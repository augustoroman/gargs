import fs from 'fs';
import path from 'path';
import * as util from './util';

/**
 * Possible value types for command line flags or positional arguments. Note
 * that this string is shown directly in the help text.
 */
type ValueType = 'string' | 'boolean' | 'filename' | 'int' | 'number';

/**
 * The state that is provided to value parsing callbacks. This parse state is
 * only for advanced parse callbacks.
 */
export interface ParseState {
  // The app that is being parsed. This can be inspected to see the flag
  // definitions. It's not expected that this will be modified during parsing
  // and no attempt to accommodate that has been made in the parsing code.
  app: App;
  // The string values that were associated with each flag/arg prior to any
  // parsing. Modifying this during a parse callback will only affect parse
  // results for values that have not yet been parsed.
  candidates: {
    flags: { [name: string]: string | string[] };
    args: { [name: string]: string | string[] };
  };
  // The current parse results that are being constructed. These may be
  // modified, however assigning values that have not yet been parsed may be
  // overwritten by subsequent parse functions.
  results: Results;

  // A function that returns the completion options for the current parse state.
  completionOptions(): Promise<string[]>;
  // A function that returns the bash completion script code.
  completionScriptBash(): string;
}
/**
 * ParseFn describes the type signature for custom value parsing function. This
 * is an async function so that user-provided functions have the option to load
 * configuration files as necessary, however please keep in mind that parsing
 * functions should load fast (avoid requiring in large js libraries) so that
 * autocompletion is fast -- those will be require'd in even if the parsing
 * function itself doesn't run.
 */
type ParseFn = (val: string, s: ParseState) => Promise<any>;
/**
 * ActionFn is the type signature for a selected command to execute.
 */
type ActionFn = (args: ParsedValues, flags: ParsedValues) => Promise<void>;
/**
 * CompleteFn is the type signature for optionally providing custom tab
 * completion values. You are passed the current value of the flag/arg to be
 * completed and return acceptable completions.
 */
type CompleteFn = (cur: string, s: ParseState) => Promise<string[]>;
/**
 * ParsedValues is just the object that holds parsed values, defined here to
 * make ActionFn easier on the eyes.
 */
interface ParsedValues {
  [name: string]: any;
}

// Re-export the utils.
export { util };

/**
 * completeFile is a helper to make a CompleteFn that will autocomplete to files
 * from the current directory. You can optionally provide a filename filter.
 *
 * TODO(aroman) This completion is actually a little ghetto -- it doesn't handle
 * tildes and it stops annoyingly at directory boundaries. It would be better to
 * integrate with bash's real file completion.
 *
 * @param filter an optional filename filter for completion options.
 */
function completeFile(filter = (_filename: string) => true): CompleteFn {
  return async (cur: string) => {
    const dir = path.dirname(cur || '.');
    const files = fs
      .readdirSync(dir)
      .map(fn => path.join(dir, fn))
      .filter(fn => filter(fn) || fs.statSync(fn).isDirectory());
    return files;
  };
}

/**
 * Args and Flags have a lot in common. This class pools all of the common
 * functionality. With the magic of typescript, this is otherwise invisible and
 * has no effect other than reducing the length of the code.
 */
class ArgFlagBase {
  /** Customize the parsed variable name, defaults to camelCase of name. */
  public varName: string;

  /** If not explicitly specified, parse value from this env var. */
  public envVar?: string;
  /** Used if not explicitly specified or set from env. */
  public defaultValue?: string | string[];
  /** Allow only the following text values (pre-parsing). */
  public allowedValues?: string[];

  /** If true, this MUST be specified on the command line. */
  public isRequired: boolean = false;
  /** Allow repeated values (makes this an array, must be final arg). */
  public isRepeated: boolean = false;

  /** optionally customize the value parsing. */
  public parseFunc: ParseFn;

  /** optionally customize the tab completion. This takes priority over allowed
   * for completion suggestions. */
  public completionFunc?: CompleteFn;

  /**
   * Basic arg constructor. Other properties may be set directly via the public
   * accessors or using the builder methods.
   *
   * @param type Value type of the arg.
   * @param name Name of the arg in the command-line docs.
   * @param help The help string for the arg.
   */
  public constructor(public type: ValueType, public name: string, public help: string) {
    // Assign defaults:
    this.varName = util.toCamelCase(name);
    this.parseFunc = ArgFlagBase.stdParseFn(type);
  }

  /**
   * Standard parsing functions, used if the user doesn't provide their own.
   * @param type
   */
  public static stdParseFn(type: ValueType): ParseFn { // eslint-disable-line consistent-return
    // eslint-disable-next-line default-case
    switch (type) {
      case 'string':
      case 'filename':
        return async (val: string) => val;
      case 'boolean':
        return async (val: string) => util.parseBoolOrThrow(val);
      case 'int':
        return async (val: string) => util.parseIntOrThrow(val);
      case 'number':
        return async (val: string) => util.parseNumOrThrow(val);
    }
    // Typescript complains if the switch above doesn't catch all possibilities
    // and we don't have a return here, so we disable the eslint rules that
    // would make us work around the nice typescript safety net.
  }

  /**
   * validate a potential string value for this arg against the allowed field.
   * @param value the value or values to consider.
   */
  public isAllowed(value: string | string[] | undefined): boolean {
    if (this.allowedValues === undefined) {
      return true;
    }
    if (value === undefined) {
      return true;
    }
    if (typeof value === 'string') {
      return this.allowedValues.includes(value);
    }
    // For arrays, check every value.
    return value.every(v => this.isAllowed(v));
  }

  /**
   * checkedParse will parse a string value, handling the three value
   * possibilities: no value (undefined), a single value (string), or a repeated
   * value (string[]).
   * @param value the value of the flag to parse
   * @param p the parser state to pass on to the parser
   */
  public async checkedParse(value: undefined | string | string[], p: Parser): Promise<any> {
    if (value === undefined) {
      if (this.isRequired) {
        throw new Error('is required but not provided');
      }
      return undefined;
    }

    // Parsing might fail though, especially since it might be a user-provided
    // function or bad input. Capture any errors cleanly.
    try {
      if (typeof value === 'string') {
        return await this.parseFunc(value, p);
      }
      return await Promise.all(value.map(val => this.parseFunc(val, p)));
    } catch (err) {
      throw new Error(`(parsing "${value}"): ${err.message}`);
    }
  }

  /** The full help string with the default & type suffixes. */
  public get fullHelp(): string {
    let text = this.help;
    // It's not really interesting to print the default for booleans that
    // default to false -- that's what anyone would already expect.
    const isBooleanWithDefaultFalse = this.type === 'boolean' && this.defaultValue === 'false';
    if (this.defaultValue && !isBooleanWithDefaultFalse) {
      text += ` [Default: ${JSON.stringify(this.defaultValue)}]`;
    }
    text += ` [${this.type}`;
    if (this.isRepeated) {
      text += ', repeatable';
    }
    // 'hidden' is only on Flag
    if (((this as any) as Flag).isHidden) {
      text += ', hidden';
    }
    // 'isDeprecated' is only on Flag
    if (((this as any) as Flag).isDeprecated) {
      text += ', deprecated';
    }
    text += ']';
    return text;
  }

  /** return the allowed list as comma-separated and with each item quoted. */
  public get allowedDoc(): string {
    if (!this.allowedValues) {
      return '<unspecified>';
    }
    return `"${this.allowedValues.join('", "')}"`;
  }

  // BUILDER functions. These apply a setting and return the current object.
  // The ': this' return type returns the derived type as appropriate.

  public repeated(val: boolean = true): this {
    this.isRepeated = val;
    return this;
  }
  public required(val: boolean = true): this {
    this.isRequired = val;
    return this;
  }
  public allow(...choices: string[]): this {
    this.allowedValues = choices;
    return this;
  }
  public default(val: string | string[]): this {
    this.defaultValue = val;
    return this;
  }
  public env(val: string): this {
    this.envVar = val;
    return this;
  }
  public parser(fn: ParseFn): this {
    this.parseFunc = fn;
    return this;
  }
  public complete(fn: CompleteFn): this {
    this.completionFunc = fn;
    return this;
  }
  public var(name: string): this {
    this.varName = name;
    return this;
  }
}

/**
 * Arg defines a positional argument. It includes all related configuration for
 * the arg as well as some helper functionality.
 */
export class Arg extends ArgFlagBase {
  /**
   * Basic arg constructor. Other properties may be set directly via the public
   * accessors or using the builder methods.
   *
   * @param type Value type of the arg.
   * @param name Name of the arg in the command-line docs.
   * @param help The help string for the arg.
   */
  public constructor(type: ValueType, name: string, help: string) {
    super(type, name, help);
  }

  // Typical arg constructor -- most args are strings.
  public static string(name: string, help: string): Arg {
    return new Arg('string', name, help);
  }

  // doc helper
  public get docName(): string {
    if (this.isRequired) {
      return `<${this.name}>`;
    } else if (this.isRepeated) {
      return `[${this.name}...]`;
    }
    return `[${this.name}]`;
  }
}

/**
 * Flag defines a commandline flag. It includes all related configuration for
 * the flag as well as some helper functionality.
 */
export class Flag extends ArgFlagBase {
  /**
   * Don't show in the help, but still allowed to be used. This will be shown in
   * the help (and marked as 'hidden') if verbose help is on.
   */
  public isHidden: boolean = false;

  /**
   * Mark this flag is 'deprecated' in the help. This is purely informational.
   */
  public isDeprecated: boolean = false;

  /** non-boolean flags require a value and it's sure nice to name the value.
   * Please customize this for nice docs! */
  public argDocName: string = 'val';

  /**
   * Basic flag constructor. Other properties may be set directly via the public
   * accessors or using the builder methods.
   *
   * @param type The type of value to parse the input into.
   * @param name The command-line name of the flag.
   * @param help The help string for the flag.
   * @param char An optional single-character shortcut for this flag.
   */
  public constructor(type: ValueType, name: string, help: string, public char?: string) {
    super(type, name, help);
  }

  // Several typical flag maker functions.
  public static bool(name: string, help: string, char?: string): Flag {
    return new Flag('boolean', name, help, char).default('false'); // false by default.
  }
  public static string(name: string, help: string, char?: string): Flag {
    return new Flag('string', name, help, char);
  }
  public static int(name: string, help: string, char?: string): Flag {
    return new Flag('int', name, help, char).argName('n');
  }
  public static number(name: string, help: string, char?: string): Flag {
    return new Flag('number', name, help, char).argName('num');
  }
  /** file creates a flag that specifies a filename and configures the tab
   * completion so that it looks for files. */
  public static file(name: string, help: string, char?: string): Flag {
    return new Flag('filename', name, help, char).argName('path').complete(completeFile());
  }
  /** requireFile creates a flag that specifies a filename that, on parsing,
   * will require() in the target file and set that as the value of the flag. */
  public static requireFile(name: string, help: string, char?: string): Flag {
    // technically you can require in directories or .node native modules, but
    // we'll only allow js & json for now.
    return (
      new Flag('filename', name, help, char)
        .argName('path')
        .complete(completeFile(fn => ['.json', '.js'].includes(path.extname(fn).toLowerCase())))
        // eslint-disable-next-line global-require,import/no-dynamic-require
        .parser(async val => require(path.resolve(val)))
    );
  }

  // doc helpers
  public get docNames(): string[] {
    const names = [`--${this.name}`];
    if (this.char) {
      names.unshift(`-${this.char}`);
    }
    if (this.type === 'boolean') {
      names.push(`--no-${this.name}`);
    }
    return names;
  }
  public get shortUsage(): string {
    const names = [];
    if (this.char) {
      names.unshift(`-${this.char}`);
    }
    if (this.type === 'boolean') {
      // If the default is false, then just print help that shows how to
      // turn the flag on. Otherwise, show both on and off help.
      if (this.defaultValue === 'false') {
        names.push(`--${this.name}`);
      } else {
        names.push(`--[no-]${this.name}`);
      }
    } else {
      names.push(`--${this.name} <${this.argDocName}>`);
    }
    return names.join(', ');
  }

  // BUILDERs for extra fields.

  public hidden(val: boolean = true): this {
    this.isHidden = val;
    return this;
  }
  public deprecated(val: boolean = true): this {
    this.isDeprecated = val;
    return this;
  }
  public argName(name: string): this {
    this.argDocName = name;
    return this;
  }
}

/**
 * Command holds the configuration for (sub)commands. This class is really the
 * meat of this library. Each command may have subcommands, flags, positional
 * arguments, as well as an associated action callback to execute.
 *
 * If a command does not have an action callback, it is conceptually a container
 * for subcommands.
 */
class Command {
  /** The map of unique subcommand names to subcommand. */
  public subcommands: { [name: string]: Command } = {};
  /** The list of flags. Flag names and varNames must be unique. */
  public flags: Flag[];
  /** The list of positional arguments. The varNames must be unique. */
  public args: Arg[];
  /** An optional action callback when this command is selected. */
  public action?: ActionFn;

  public constructor(
    public parent: Command | null,
    public name: string,
    public help: string,
    options: Command.Options = {},
  ) {
    this.flags = options.flags || [];
    this.args = options.args || [];
    this.action = options.action;
  }

  /**
   * Add a subcommand to this command.
   * @param name name of the subcommand
   * @param help doc string for the subcommand
   * @param options additional options to define the subcommand
   */
  public command(name: string, help: string, options?: Command.Options): Command {
    if (name in this.subcommands) {
      throw new Error(`"${this.fullName}" has subcommand ${name} registered twice`);
    }
    this.subcommands[name] = new Command(this, name, help, options);
    return this.subcommands[name];
  }

  /**
   * Find a flag definition that matches the 'name', 'char', or varName' fields.
   * @param field Which field to search.
   * @param value The value to look for.
   */
  public lookupFlagByField(field: 'name' | 'char' | 'varName', value: string): Flag | null {
    // TODO(aroman) Make a LUT of name->config for fasterness.
    const matched = this.flags.find(flag => flag[field] === value);
    if (matched) {
      return matched;
    }
    if (this.parent) {
      return this.parent.lookupFlagByField(field, value);
    }
    return null;
  }

  /** The "fully-qualified" command name (e.g. "core import content"). */
  public get fullName(): string {
    if (this.parent) {
      return `${this.parent.fullName} ${this.name}`;
    }
    return this.name;
  }

  /** Compact usage string, e.g. "core run e2e <state> [target]" */
  private get shortUsage(): string {
    const argUsage = this.args.map(arg => arg.docName).join(' ');
    return `${this.fullName} ${argUsage}`;
  }

  /** All flags from parent commands. This does NOT include this command's flags. */
  public inheritedFlags(): Flag[] {
    if (!this.parent) {
      return [];
    }
    return this.parent.inheritedFlags().concat(this.parent.flags);
  }

  /** The full, formatted doc for this command. */
  public fullUsage(verbose: boolean = false): string {
    // First construct the basic usage examples. There are three interesting
    // possibilities here:
    // 1. This command is a leaf command that has an associated action. In that
    //    case, we'll just print out the usage for this command.
    // 2. This command is an interior container command that only has
    //    subcommands and no action associated with itself. In that case we'll
    //    just print out the available subcommands.
    // 3. This is an interior command but ALSO has an associated action. Here
    //    we'll print both the local usage and the subcommands.
    let baseUsage: string;
    const localUsage = `  ${this.shortUsage}\t${this.help}`;
    const subcommandUsage = Object.values(this.subcommands).map(
      cmd => `  ${cmd.shortUsage}\t${cmd.help}`,
    );
    const hasSubs = subcommandUsage.length > 0;
    const hasLocalAction = !!this.action || this.args.length > 0;
    if (hasSubs && hasLocalAction) {
      subcommandUsage.unshift(localUsage);
      baseUsage = `Usage:\n${util.align(subcommandUsage).join('\n')}`;
    } else if (hasLocalAction) {
      baseUsage = `Usage:\n${util.align([localUsage]).join('\n')}`;
    } else {
      baseUsage = `Usage:\n${util.align(subcommandUsage).join('\n')}`;
    }

    // If there are any defined args, print out the detailed help for those.
    const argLines = this.args.map(arg => `  ${arg.docName}\t${arg.fullHelp}`);
    let argDocs = util.align(argLines).join('\n');
    if (argDocs.length > 0) {
      argDocs = `\nArgs:\n${argDocs}\n`;
    }

    // If there are any flags, print out the detailed help for those.
    const flagLines = this.flags
      .filter(f => verbose || !f.isHidden)
      .map(f => `  ${f.shortUsage}\t${f.fullHelp}`);
    let flagDocs = util.align(flagLines).join('\n');
    if (flagDocs.length > 0) {
      flagDocs = `\nFlags:\n${flagDocs}\n`;
    }

    // We'll also print out the flags defined by parent commands since those
    // are all available too.
    const extraFlagLines = this.inheritedFlags()
      .filter(f => verbose || !f.isHidden)
      .map(f => `  ${f.shortUsage}\t${f.fullHelp}`);
    let extraFlagDocs = util.align(extraFlagLines).join('\n');
    if (extraFlagDocs.length > 0) {
      extraFlagDocs = `\nOther Flags:\n${extraFlagDocs}\n`;
    }

    // Now just assemble the final string.
    return `${baseUsage}\n${argDocs}${flagDocs}${extraFlagDocs}`;
  }
}

// The namespace is here to lump options into the `Command.*` scope since
// typescript won't let me define Options directly within the Command class.
namespace Command { // eslint-disable-line no-redeclare
  /**
   * Options that can be provided to configure a command.
   */
  export interface Options {
    /** Define any flags for this command or any subcommands. */
    flags?: Flag[];
    /** Define any arguments for the command. Arguments are not allowed if this
     * command has any subcommands. */
    args?: Arg[];
    /** Optionally specify an action to occur when this command is selected. The
     * final parsed args and flags will be provided. This is not invoked for
     * parent commands when subcommands are specified. */
    action?: ActionFn;
  }
}

/**
 * App is the top-level container to interact with the flag parsing package. An
 * App contains the root Command as well as other helpful configurable fields.
 */
export class App {
  /** The root command. */
  public root: Command;
  /** Optionally customize where stdout goes by default. */
  public stdout = console.log; // eslint-disable-line no-console
  /** Optionally customize where stderr goes by default. */
  public stderr = console.error; // eslint-disable-line no-console

  public constructor(public appname: string, help: string, options: Command.Options) {
    this.root = new Command(null, appname, help, options); // root has no parent.
  }

  /**
   * Add subcommands to this app. This just passes through to the root.
   * @param name of the subcommand.
   * @param help for this command.
   * @param options options for this command (flags, args, action, etc).
   */
  public command(name: string, help: string, options?: Command.Options): Command {
    return this.root.command(name, help, options);
  }

  /**
   * Parse a given commandline and environment and return the parsed results.
   * Even though this is almost entirely synchronous, it's possible to register
   * custom parsing operations that are async and therefore this function is
   * also async.
   * @param argv the command-line arguments used to launch this process.
   *   Typically this is just `process.argv`.
   * @param env the environment variables used to launch this process. Typically
   *   this is just `process.env`.
   * @param log an optional logger to use during parsing. This is primarily
   *   available for debugging the parsing.
   */
  public async parse(
    argv: string[] = process.argv,
    env: NodeJS.ProcessEnv = process.env,
    log: util.Logger = util.nullLogger,
  ): Promise<Results> {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return new Parser(this, argv, env, log).parse();
  }

  /**
   * Add several default flags to the app that basically everyone should have.
   * They are added to the beginning of the root Command so that they are the
   * first flags.
   */
  public withDefaultFlags(): App {
    this.root.flags.unshift(
      Flag.bool('help', 'Print help and exit', 'h'),
      Flag.bool('completion-bash', 'Output possible completions for the given args')
        .hidden()
        .var('showBashCompletions'),
      Flag.bool('completion-script-bash', 'Generate completion script for bash.')
        .hidden()
        .parser(async (val: string, p: ParseState) => {
          if (!util.parseBoolOrThrow(val)) {
            return false;
          }
          this.stdout(p.completionScriptBash());
          return this.terminate(0);
        }),
    );
    return this;
  }

  /** Display the full help for the given parse results. */
  public printHelp(res: Results, verbose = false, docOut = this.stdout, errOut = this.stderr) {
    docOut(`${this.root.help}\n\n${res.command.fullUsage(verbose)}`);
    if (res.errors.length > 0) {
      errOut(`ERROR: ${res.errors.join('\nERROR: ')}`);
    }
  }

  /**
   * Terminate an app early. This can be overridden to do special shutdown
   * stuffs.
   */
  public terminate(code: number) {
    process.exit(code);
  }
}

/**
 * Results represents the results of parsing a command line, including any
 * errors.
 */
export class Results {
  public constructor(public binary: string, public app: App) {
    this.command = app.root;
  }

  /**
   * The command that the parsing ended on. If there were no errors, then
   * this represents the selected Command.
   */
  public command: Command;
  /**
   * The parsed flag values. All flags from the root Command to the selected
   * Command will be in this map, but they may be `undefined` if no value and
   * no default was available.
   */
  public flags: { [name: string]: any } = {};
  /**
   * The parsed positional args for this command. All args will be present in
   * the map but may be `undefined` if no value was provided.
   */
  public args: { [name: string]: any } = {};

  /**
   * Errors encountered during parsing. They are collected here and printed
   * during `run` by default.
   */
  public errors: string[] = [];

  /**
   * run is a convenience function to provide typical execution semantics after
   * parsing. In particular, this:
   *   - prints help and error messages if there were any parsing errors.
   *   - prints help if `flags.help` is true.
   *   - prints help if the selected command doesn't have an action callback.
   *   - otherwise, runs the selected command's action callback.
   * @param verboseHelp whether to include hidden and deprecated flags in help.
   * @param stdout where to non-error help output.
   * @param stderr where to print error output.
   */
  public async run(verboseHelp = false, stdout = this.app.stdout, stderr = this.app.stderr) {
    // TODO(aroman) Consider separating the help code into a helper function:
    // maybePrintHelpAndTerminate(). That way, user code would just call that
    // and then do whatever they wanted with result.command.action.
    if (this.errors.length > 0) {
      this.app.printHelp(this, verboseHelp, stderr, stderr);
      this.app.terminate(1);
    } else if (this.flags.help) {
      this.app.printHelp(this, verboseHelp, stdout);
      this.app.terminate(0);
    } else if (!this.command.action) {
      // This is a container command? No action defined, I guess we print help.
      this.app.printHelp(this, verboseHelp, stderr, stderr);
      this.app.terminate(1);
    } else {
      // Looking for middleware? Just modify `result.command.action` before
      // calling run().
      await this.command.action(this.args, this.flags);
    }
  }
}

/**
 * Parser does all of the parsing of a specific command line given the
 * configuration structures defined above.
 */
class Parser implements ParseState {
  /** the REMAINING argv that needs to be parsed */
  public remainingArgv: string[];

  /** the results that all parsing output goes into */
  public results: Results;

  /**
   * Candidate values for discovered flags and args. These are always strings
   * whose values are set during the structure parsing phase. The value parsing
   * phase will take candidates and parse the values into the actual results on
   * successful parsing.
   */
  public candidates: {
    flags: { [name: string]: string | string[] };
    args: { [name: string]: string | string[] };
  } = { flags: {}, args: {} };

  /**
   * If we encounter an arg that is `--` then that means that subsequent args
   * that begin with hypens are arguments not flags.
   *
   * For example, given:
   *    `./mybin --foo -- --bar`
   * then `--foo` is a flag but `--bar` is an arg.
   */
  public parsingFlags = true;

  /**
   * Index of the next argument for this command. Normally each arg increments
   * this by 1, but the last arg may accept repeated values.
   */
  public argnum = 0;

  public constructor(
    public app: App,
    public argv: string[],
    public env: NodeJS.ProcessEnv,
    public log: util.Logger,
  ) {
    // Copy the argv so we can modify it.
    this.remainingArgv = [...argv];
    const binary = this.removeBinaryName(this.remainingArgv);
    this.results = new Results(binary, this.app);
    this.log = log || util.nullLogger;
    // Wrap the logger so that log.error(*) adds an error to the results.
    this.log = new util.RecordErrorsLogger(this.log, this.results.errors);
  }

  /**
   * Return a list of possible values at this point in the command-line. Note
   * that this list doesn't necessary have to be only suffixes for the last value on
   * the commandline -- the bash completion functionality correctly filters out
   * values that don't start with text immediately before the cursor.
   *
   * That is, when you have this:
   *   myprog -x --some<TAB>
   * you will public get invoked with:
   *   myprog --completion-bash -x --some
   *
   * But when you have this:
   *   myprog -x --some <TAB>
   * you will still public get invoked with exactly the same thing:
   *   myprog --completion-bash -x --some
   *
   * We can't tell if that last space was there (unless the completion script
   * is bad -- I lifted it from kingpin).
   *
   * Regardless, if we always return options like ['--some-tab', 'blah']
   * then the first case will complete immediately (since only '--some-tab'
   * applies) and the second case will show both possibilities.
   */
  public async completionOptions(): Promise<string[]> {
    const options = [];
    const cmd = this.results.command;

    // Take the last value. We know process.argv has at least the binary name.
    // Filter out the flag to request completions, but anything else is fine.
    const args = process.argv.filter(arg => arg !== '--completion-bash');
    const cur = args.pop() || '';
    const prev = args.pop();

    const allFlags = cmd.flags.concat(cmd.inheritedFlags());

    // Check to see if the last entry on the commandline was a non-boolean flag.
    // If it was, then the completions that make sense right now are the allowed
    // values for that flag!
    const curFlag = allFlags.find(
      flag => flag.type !== 'boolean' && prev && flag.docNames.includes(prev),
    );
    if (curFlag) {
      if (curFlag.completionFunc) {
        options.push(...(await curFlag.completionFunc(cur, this)));
      } else if (curFlag.allowedValues) {
        options.push(...curFlag.allowedValues);
      }
      return options;
    }

    // Otherwise, we're open to any new value: subcommands, args, or flags.
    // We'll only add the flag options if they've started typing '-' or there
    // are no other completions.

    // Push all possible subcommands of the last parsed command to the option
    // list.
    options.push(...Object.keys(cmd.subcommands));

    // Find the arg that we're considering and, if it has a list of allowed
    // values, push those allowed values onto the completion list.
    const arg = cmd.args[this.argnum];
    if (arg && arg.completionFunc) {
      options.push(...(await arg.completionFunc(cur, this)));
    } else if (arg && arg.allowedValues) {
      options.push(...arg.allowedValues);
    }

    // Check to see if the last entry on the command-line looks like a flag or
    // the start of a flag. If so, then we'll include flags in the list of
    // possible completions.
    if (cur.startsWith('-')) {
      allFlags
        .filter(f => {
          if (cur.length > 3 && f.docNames.some(name => name.startsWith(cur))) {
            return true;
          }
          return !f.isHidden;
        })
        .forEach(f => f.docNames.forEach(name => options.push(name)));
    }

    // Finally, if there are no other possible completions at all, let's list
    // all of the long-name flags (and not include the single-dash shortcuts):
    if (options.length === 0) {
      return allFlags.filter(f => !f.isHidden).map(f => `--${f.name}`);
    }

    return options;
  }

  /**
   * The bash script to use for triggering completion. This was lifted from
   * kingpin:
   *   https://github.com/alecthomas/kingpin/blob/947dcec5ba9c011838740e680966fd7087a71d0d/templates.go#L235-L244
   */
  public completionScriptBash(): string {
    const name = path.basename(this.results.binary);
    return `
_${name}_bash_autocomplete() {
  local cur prev opts base
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  opts=$( \${COMP_WORDS[0]} --completion-bash \${COMP_WORDS[@]:1:$((COMP_CWORD - 1))} "\${cur}" )
  COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )
  return 0
}
complete -F _${name}_bash_autocomplete ${name}`;
  }

  /**
   * Remove the binary name from the provided argv and return it.
   * @param argv A copy of the process argv -- this is modified!
   */
  private removeBinaryName(argv: string[]): string {
    // Strip off any node binary references from the beginning of argv.
    while (argv.length > 0 && argv[0].endsWith('/node')) {
      this.log.debug('dropping node ref from argv:', argv.shift());
    }
    // Now the first argv should be the binary name, so pull that out.
    if (argv.length === 0) {
      throw new Error(
        'The process args are empty but should have at least the name of the binary.',
      );
    }
    // We checked the length above, so the array can't be empty.
    return argv.shift() as string;
  }

  /**
   * Release the hounds!
   */
  public async parse(): Promise<Results> {
    // Command-line parsing occurs in two major phases:
    //
    // Phase 1: Parse the structure of the commandline, determining the string
    // value for every flag & target, and selecting the appropriate
    // (sub)command. This involves mapping all of the default values, reading
    // from the env, and associating the appropriate parts of the commandline
    // with the corresponding flags and args.
    //
    // Phase 2: Convert all of the string values into the final typed value by
    // running the parsers for each flag/arg.
    //
    // Separating into these two phases allows us to avoid parsing invalid
    // values that are later overridden. E.g. it doesn't matter if the env var
    // value is invalid if the commandline is correct.
    //
    // Also, the first phase is synchronous, but the second phase (parsing)
    // can be async.
    this.parseStructure(this.app.root); // phase 1
    await this.parseValues(this.results.command); // phase 2

    // phase 3: bash completions. This is performed AFTER all of the parse has
    // completed so that completions can depend on previous parsed values. For
    // example, a parsed configuration file.
    if (this.results.flags.showBashCompletions) {
      this.app.stdout((await this.completionOptions()).join('\n'));
      this.app.terminate(0);
    }

    return this.results;
  }

  // This is phase 1 of the parsing: Given a command, we'll parse the remaining
  // argv for that comand (and potentially any subcommands) and associate all
  // flag & arg values with the corresponding strings.
  private parseStructure(cmd: Command) {
    this.results.command = cmd;
    let foundPositionalArgs = false;
    while (this.remainingArgv.length > 0) {
      const arg = this.remainingArgv.shift() as string;
      this.log.debug(`Processing arg [${arg}]`);
      if (this.parsingFlags && arg.startsWith('-')) {
        this.parseFlag(cmd, arg);
      } else if (!foundPositionalArgs && arg in cmd.subcommands) {
        this.parseStructure(cmd.subcommands[arg]);
      } else {
        // Once we've seen a positional arg, we can't subsequently descend into
        // a subcommand.
        foundPositionalArgs = true;
        this.parseArg(cmd, arg);
      }
    }
    this.setDefaults(cmd);
  }

  // This is phase 2 of the parsing:
  private async parseValues(cmd: Command) {
    // When parsing the values, we proceed in a very specific order:
    // * First we'll parse all of the flags in the order that they were defined
    //   from the root command through to the selected leaf command.
    // * Then we'll parse each of the arguments (which can only be on the
    //   selected leaf command).
    // This well-defined order allows any custom parsing to rely on the flag
    // definition ordering to pass data along (since they public get the Parser state).

    // So, first parse all parent flags.
    if (cmd.parent) {
      await this.parseValues(cmd.parent);
    }

    // Now parse all of our flags. This is a loop (instead of .forEach) since we
    // want to parse and await each flag sequentially.
    for (const flag of cmd.flags) {
      const value = this.candidates.flags[flag.varName];
      try {
        this.results.flags[flag.varName] = await flag.checkedParse(value, this);
      } catch (err) {
        this.log.error(`Flag --${flag.name} ${err.message}`);
      }
    }

    // Finally, parse all of the args.
    for (const arg of cmd.args) {
      const value = this.candidates.args[arg.varName];
      try {
        this.results.args[arg.varName] = await arg.checkedParse(value, this);
      } catch (err) {
        this.log.error(`Arg '${arg.name}' ${err.message}`);
      }
    }
  }

  /**
   * Attempt to parse the value as a positional argument.
   */
  private parseArg(cmd: Command, val: string) {
    // Do we have any positional arguments left?
    if (this.argnum >= cmd.args.length) {
      if (this.argnum === 0) {
        this.log.error(`No such subcommand or positional argument for "${val}".`);
      } else {
        this.log.error(`Unexpected (extra) positional argument "${val}".`);
      }
      // Advance past this arg so that we only get at most one "No such
      // subcommand" error.
      this.argnum++; // TODO(aroman) do better error handling?
      return;
    }

    const arg = cmd.args[this.argnum];
    if (!arg.isAllowed(val)) {
      this.log.error(`Arg "${arg.name}" is "${val}" but must be one of ${arg.allowedDoc}`);
    }

    // If the arg is repeated, just add it to the list of values.
    if (arg.isRepeated) {
      // Maybe initialize the value.
      this.candidates.args[arg.varName] = this.candidates.args[arg.varName] || [];
      // Now it's a string[] for sure, so push the value.
      // eslint-disable-next-line no-extra-parens
      (this.candidates.args[arg.varName] as string[]).push(val);
      // Don't advance argnum: repeated args will consume all the rest.
      return;
    }

    this.candidates.args[arg.varName] = val;
    // We've filled this arg, move on.
    this.argnum++;
  }

  /**
   * Attempt to parse the value as a flag.
   */
  private parseFlag(cmd: Command, arg: string) {
    if (arg === '--') {
      this.log.debug('Arg "--" found, no more flag parsing.');
      this.parsingFlags = false;
      return;
    }

    let val: string | undefined;
    let flag: Flag;
    if (arg.startsWith('--')) {
      let name;
      [name, val] = arg.slice(2).split('=', 2);

      if (name.startsWith('no-')) {
        name = name.slice(3);
        if (val) {
          this.log.error(
            `Ignored flag value provided for negated boolean flag ${name} in "${arg}"`,
          );
        }
        val = 'false';
      }
      const found = cmd.lookupFlagByField('name', name);
      if (found === null) {
        this.log.error(`No flag for "${arg}" in "${cmd.fullName}"`);
        return;
      }
      flag = found;
    } else {
      const char = arg.slice(1, 2);
      // handle -fVAL for a '-f' flag.
      if (arg.length > 2) {
        val = arg.slice(2);
      }
      const found = cmd.lookupFlagByField('char', char);
      if (found === null) {
        this.log.error(`No flag for "${arg}" in "${cmd.fullName}"`);
        return;
      }
      flag = found;
    }

    // Check to see if we need to consume the next string in the command-line.
    // For example:
    //    --name bob
    //           ^^^-- the next string.
    // vs
    //    --name=bob
    //    ^^^^^^^^^^-- all one string
    if (val === undefined) {
      if (flag.type === 'boolean') {
        val = 'true';
      } else {
        val = this.remainingArgv.shift();
      }
    }

    // We should have _some_ string value for the flag now. If it's undefined,
    // then we've probably just run out of command-line.
    if (val === undefined) {
      this.log.error(`Missing value for "${arg}" (expected ${flag.type})`);
      return;
    }

    if (flag.type === 'boolean' && val === undefined) {
      val = 'true';
    }

    if (!flag.isAllowed(val)) {
      this.log.error(`Flag "${flag.name}" is "${val}" but must be one of ${flag.allowedDoc}`);
      return;
    }

    if (flag.isRepeated) {
      this.log.debug(`Adding flag "${flag.name}" value of "${val}"`);
      // Now it's a string[] for sure, so push the value.
      this.candidates.flags[flag.varName] = this.candidates.flags[flag.varName] || [];
      // eslint-disable-next-line no-extra-parens
      (this.candidates.flags[flag.varName] as string[]).push(val);
      return;
    }

    // Have we already seen this flag?
    if (this.candidates.flags[flag.varName]) {
      this.log.error(
        `Flag "${flag.name}" is specified more than once but is not a repeatable flag.`,
      );
      return;
    }

    this.log.debug(`Setting flag "${flag.name}" to "${val}"`);
    this.candidates.flags[flag.varName] = val;
  }

  /**
   * Assign all default values into the flag/arg candidates for any that don't
   * have a parsed value.
   */
  private setDefaults(cmd: Command) {
    // setDefault is a little helper function since we do basically the same
    // thing for flags and args.
    const setDefault = (cfg: Flag | Arg, target: { [key: string]: any }) => {
      // If it's already configured, return.
      if (cfg.varName in target) {
        return;
      }

      // Informational for nicer logging.
      const type = cfg instanceof Arg ? 'Arg' : 'Flag';

      let value: string | string[] | undefined;

      if (cfg.envVar && cfg.envVar in this.env) {
        // If an environment var is specified and available in the env, use that.
        value = this.env[cfg.envVar];
        this.log.debug(
          `${type} "${cfg.name}" initialized from env var "${cfg.envVar}" to ` +
            `"${target[cfg.varName]}"`,
        );
      } else if (cfg.defaultValue) {
        // Otherwise, if the default is available, fall back to that.
        value = cfg.defaultValue;
        this.log.debug(
          `${type} "${cfg.name}" initialized to default value "${target[cfg.varName]}"`,
        );
      } else {
        // At the very least, every configured flag is initialized to undefined.
        value = undefined;
        this.log.debug(`${type} "${cfg.name}" initialized to undefined.`);
      }

      if (!cfg.isAllowed(value)) {
        target[cfg.varName] = undefined;
        this.log.error(
          `${type} "${cfg.name}" value of ${value} is one of the allowed values: ${cfg.allowedDoc}`,
        );
        return;
      }

      target[cfg.varName] = value;
    };

    cmd.flags.forEach(flag => setDefault(flag, this.candidates.flags));
    cmd.args.forEach(arg => setDefault(arg, this.candidates.args));
  }
}

import { App, Flag, Arg } from '../src/index';

describe('parsing flags', () => {
  // For lots of debugging logs, set fullDebug true to log each step of the
  // parsing as well as input and output.
  const fullDebug = false;

  // Add "focus" to a group or case in testTable below to focus it.
  // e.g. { focus, in: ['--val=false'], out: false },
  //        ^^^^^^
  // When a given test is focused, it will turn on full debug logs for that
  // test.
  const focus = true; // eslint-disable-line @typescript-eslint/no-unused-vars,no-unused-vars

  interface TestCase {
    focus?: boolean; // focus this testcase AND turn on full debug.
    in: string[]; // command line input string
    env?: NodeJS.ProcessEnv; // optional env vars
    out?: boolean | string | number | string[]; // expected flag result if present
    err?: boolean;
  }
  interface TestGroup {
    focus?: boolean;
    label: string;
    flag: Flag;
    cases: TestCase[];
  }
  const testTable: TestGroup[] = [
    // Actual tests start here:
    {
      label: 'a boolean flag',
      flag: Flag.bool('val', 'flaghelp', 'v'),
      cases: [
        { in: ['-v'], out: true },
        { in: ['-vtrue'], out: true },
        { in: ['--val'], out: true },
        { in: ['--val=true'], out: true },
        // unset or set to false
        { in: [], out: false },
        { in: ['-vfalse'], out: false },
        { in: ['--no-val'], out: false },
        { in: ['--val=false'], out: false },
        // errors
        { in: ['--', '-v'], out: false, err: true }, // extra args
        { in: ['--', '--val'], out: false, err: true }, // extra args
        { in: ['--', '--val=true'], out: false, err: true }, // extra args

        // TODO(aroman) This is bad parsing -- we put the string in there
        // temporarily, but then it got left there after the parsing failed.
        // { in: ['--val=xyz'], out: false, err: true }, // parse error

        // error: unlike non-bools, bools don't consume the next value.
        { in: ['--val', 'false'], out: true, err: true }, // extra arg
      ],
    },
    {
      label: 'a boolean flag with default and env var',
      flag: Flag.bool('val', 'flaghelp', 'v')
        .default('true')
        .env('VAL'),
      cases: [
        { in: [], out: true },
        { in: ['-v'], out: true },
        { in: ['-vfalse'], out: false },
        { in: ['--val=false'], out: false },
        { in: ['--no-val'], out: false },
        // env var overrides the default.
        { in: [], env: { VAL: 'false' }, out: false },
        // but actual flag usage overrides env.
        { in: ['-v'], env: { VAL: 'false' }, out: true },
      ],
    },
    {
      label: 'different values to set/unset a boolean flag',
      flag: Flag.bool('val', 'flaghelp', 'v')
        .default('true')
        .env('VAL'),
      cases: [
        { in: [], env: { VAL: '1' }, out: true },
        { in: [], env: { VAL: '0' }, out: false },
        { in: [], env: { VAL: 'true' }, out: true },
        { in: [], env: { VAL: 'false' }, out: false },
        { in: [], env: { VAL: 'TrUe' }, out: true },
        { in: [], env: { VAL: 'fAlSe' }, out: false },
        { in: [], env: { VAL: 'T' }, out: true },
        { in: [], env: { VAL: 'F' }, out: false },
        { in: [], env: { VAL: 'yes' }, out: true },
        { in: [], env: { VAL: 'no' }, out: false },
        { in: [], env: { VAL: 'Y' }, out: true },
        { in: [], env: { VAL: 'N' }, out: false },
        { in: [], env: { VAL: 'YES' }, out: true },
        { in: [], env: { VAL: 'NO' }, out: false },
      ],
    },
    {
      label: 'a string flag',
      flag: Flag.string('val', 'flaghelp', 'v'),
      cases: [
        { in: ['-v', 'a'], out: 'a' },
        { in: ['-vabc'], out: 'abc' },
        { in: ['--val', 'b'], out: 'b' },
        { in: ['--val=c'], out: 'c' },
        { in: ['--val='], out: '' },
        // value can look like a flag
        { in: ['--val', '--'], out: '--' },
        { in: ['-v', '-f'], out: '-f' },
        { in: ['--val', '--f'], out: '--f' },
        // unset, no default
        { in: [], out: undefined },
        // errors
        { in: ['-v'], out: undefined, err: true }, // no value
        { in: ['--val'], out: undefined, err: true }, // no value
        { in: ['--', '-v', 'a'], out: undefined, err: true }, // extra args
        { in: ['--', '-vabc'], out: undefined, err: true }, // extra args
        { in: ['--', '--val', 'a'], out: undefined, err: true }, // extra args
        { in: ['--', '--val=c'], out: undefined, err: true }, // extra args
      ],
    },
    {
      label: 'a string flag with default and env var',
      flag: Flag.string('val', 'flaghelp', 'v')
        .default('yay')
        .env('VAL'),
      cases: [
        { in: [], out: 'yay' },
        { in: ['-vabc'], out: 'abc' },
        { in: ['--val=xyz'], out: 'xyz' },
        { in: ['--val', 'boo'], out: 'boo' },
        // env var overrides the default
        { in: [], env: { VAL: 'lalal' }, out: 'lalal' },
        // but actual flag usage overrides env.
        { in: ['-vx'], env: { VAL: 'lalal' }, out: 'x' },
      ],
    },
    {
      label: 'a repeated string flag with allowed values',
      flag: Flag.string('val', 'flaghelp', 'v')
        .env('VAL')
        .allow('abc', 'xyz')
        .repeated(),
      cases: [
        { in: ['-v', 'abc', '-v', 'xyz'], out: ['abc', 'xyz'] },
        // If any value is not allowed, parsing fails.
        { in: ['-v', 'not-allowed', '-v', 'abc'], out: ['abc'], err: true },
        { in: ['-v', 'abc', '-v', 'not-allowed'], out: ['abc'], err: true },
      ],
    },
    {
      label: 'a repeated string flag with allowed values and multiple defaults',
      flag: Flag.string('val', 'flaghelp', 'v')
        .env('VAL')
        .allow('abc', 'xyz')
        .default(['x', 'y'])
        .repeated(),
      cases: [
        { in: [], out: undefined, err: true },
      ],
    },
    {
      label: 'an int flag',
      flag: Flag.int('val', 'flaghelp', 'v'),
      cases: [
        { in: ['-v', '1'], out: 1 },
        { in: ['-v123'], out: 123 },
        { in: ['--val', '2'], out: 2 },
        { in: ['--val=3'], out: 3 },
        { in: ['--val='], out: 0 },
        // value can look like a flag
        { in: ['-v', '-3'], out: -3 },
        // value can use exponential notation as long as it's still an int.
        { in: ['-v', '-1.2e5'], out: -120000 },
        // unset, no default
        { in: [], out: undefined },
        // errors
        { in: ['-v'], out: undefined, err: true }, // no value
        { in: ['--val'], out: undefined, err: true }, // no value
        { in: ['-v', 'x'], out: undefined, err: true }, // not a number
        { in: ['-v', '1x'], out: undefined, err: true }, // not a number
        { in: ['-v', 'x1'], out: undefined, err: true }, // not a number
        { in: ['-v', '1.2'], out: undefined, err: true }, // not an integer
        { in: ['-v', '-3.5'], out: undefined, err: true }, // not an integer
        { in: ['-v', '-3.5123e3'], out: undefined, err: true }, // not an integer
        { in: ['--', '-v', '1'], out: undefined, err: true }, // extra args
        { in: ['--', '-v2'], out: undefined, err: true }, // extra args
        { in: ['--', '--val', '3'], out: undefined, err: true }, // extra args
        { in: ['--', '--val=4'], out: undefined, err: true }, // extra args
      ],
    },
    {
      label: 'an number flag',
      flag: Flag.number('val', 'flaghelp', 'v'),
      cases: [
        { in: ['-v', '1'], out: 1 },
        { in: ['-v123'], out: 123 },
        { in: ['--val', '2'], out: 2 },
        { in: ['--val=3'], out: 3 },
        { in: ['--val='], out: 0 },
        { in: ['-v', '1.2'], out: 1.2 },
        { in: ['-v123.5'], out: 123.5 },
        { in: ['--val', '2.7'], out: 2.7 },
        { in: ['--val=3.3'], out: 3.3 },
        // value can look like a flag
        { in: ['-v', '-3.2'], out: -3.2 },
        { in: ['-v', '-1.2e5'], out: -120000 },
        { in: ['-v', '-1.23456e3'], out: -1234.56 },
        // unset, no default
        { in: [], out: undefined },
        // errors
        { in: ['-v'], out: undefined, err: true }, // no value
        { in: ['--val'], out: undefined, err: true }, // no value
        { in: ['-v', 'x'], out: undefined, err: true }, // not a number
        { in: ['-v', '1x'], out: undefined, err: true }, // not a number
        { in: ['-v', 'x1'], out: undefined, err: true }, // not a number
        { in: ['--', '-v', '1'], out: undefined, err: true }, // extra args
        { in: ['--', '-v2'], out: undefined, err: true }, // extra args
        { in: ['--', '--val', '3'], out: undefined, err: true }, // extra args
        { in: ['--', '--val=4'], out: undefined, err: true }, // extra args
      ],
    },
  ];

  async function parseFlag(flags: Flag[], cmdline: string[], env: {}, debug: boolean) {
    const app = new App('testapp', 'apphelp', { flags });
    const logger = debug ? console : undefined;
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(`flags: ${flags}`);
    }
    const results = await app.parse(['/bin/cmd', ...cmdline], env, logger);
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(`parsed flags: ${results.flags}\nerrors: ', ${results.errors}`);
    }
    return results;
  }

  // These are captured to switch between it/fit and describe/fdescribe.
  const jasmineIt = it;
  const jasmineDescribe = describe;

  testTable.forEach((testGroup) => {
    const describe = testGroup.focus ? fdescribe : jasmineDescribe;
    describe(testGroup.label, () => {
      testGroup.cases.forEach((testCase: any) => {
        const envInfo = testCase.env ? ` with env ${JSON.stringify(testCase.env)}` : '';
        const it = testCase.focus ? fit : jasmineIt;
        const debug = fullDebug || testCase.focus;
        if (testCase.err) {
          it(`should fail when parsing [${testCase.in}]${envInfo}`, async () => {
            const result = await parseFlag([testGroup.flag], testCase.in, testCase.env, debug);
            expect(result.flags.val).toEqual(testCase.out);
            expect(result.errors).not.toEqual([]);
          });
        } else {
          it(`should parse [${testCase.in}]${envInfo} to ${testCase.out}`, async () => {
            const result = await parseFlag([testGroup.flag], testCase.in, testCase.env, debug);
            expect(result.flags.val).toEqual(testCase.out);
            expect(result.errors).toEqual([]);
          });
        }
      });
    });
  });
});

describe('help strings', () => {
  function toRegexThatIgnoresPrefixSpacing(s: string) {
    return s.
      replace(/[.*+?^${}()|[\]\\]/g, '\\$&'). // regex-escape the string
      replace(/\n\s*/g, '\\s*');              // ignore spaces after newlines.
  }

  const app = new App('myapp', 'Does some stuff', {
    flags: [
      Flag.int('num', 'some number', 'n').required().default('5'),
      Flag.string('str', 'some string').allow('a','b'),
      Flag.string('rstr', 'some repeated string').repeated(),
      Flag.bool('opt', 'some boolean option').var('optVar'),
      Flag.bool('hopt', 'some hidden option').hidden(),
      Flag.bool('dopt', 'some deprecated option').deprecated(),
    ],
    args: [
      Arg.string('str-arg', 'blah').allow('x', 'y'),
    ]
  }).withDefaultFlags();

  it('should generate nice help strings', async () => {
    const res = await app.parse(['-n=5', '--opt', '--no-dopt', 'foo'])
    let stdout = '';
    let stderr = '';
    app.printHelp(res, false, (s:string) => { stdout += s; }, (s:string) => { stderr += s; });

    const expectedStdout = `Does some stuff

      Usage:
        myapp [str-arg]      Does some stuff

      Args:
        [str-arg]            blah [string]

      Flags:
        -h, --help           Print help and exit [boolean]
        -n, --num <n>        some number [Default: "5"] [int]
        --str <val>          some string [string]
        --rstr <val>         some repeated string [string, repeatable]
        --opt                some boolean option [boolean]
        --dopt               some deprecated option [boolean, deprecated]
    `;
    expect(stdout).toMatch(toRegexThatIgnoresPrefixSpacing(expectedStdout));

    const expectedStderr = `
      ERROR: Arg "str-arg" is "foo" but must be one of "x", "y"
    `;
    expect(stderr).toMatch(toRegexThatIgnoresPrefixSpacing(expectedStderr));
  });

  it('should generate nice help strings including hidden strings with verbose', async () => {
    const res = await app.parse(['-n=5', '--opt', '--no-dopt', 'foo'])
    let stdout = '';
    let stderr = '';
    app.printHelp(res, true, (s:string) => { stdout += s; }, (s:string) => { stderr += s; });

    const expectedStdout = `Does some stuff

      Usage:
        myapp [str-arg]      Does some stuff

      Args:
        [str-arg]            blah [string]

      Flags:
        -h, --help                 Print help and exit [boolean]
        --completion-bash          Output possible completions for the given args [boolean, hidden]
        --completion-script-bash   Generate completion script for bash. [boolean, hidden]
        -n, --num <n>              some number [Default: "5"] [int]
        --str <val>                some string [string]
        --rstr <val>               some repeated string [string, repeatable]
        --opt                      some boolean option [boolean]
        --hopt                     some hidden option [boolean, hidden]
        --dopt                     some deprecated option [boolean, deprecated]
    `;
    expect(stdout).toMatch(toRegexThatIgnoresPrefixSpacing(expectedStdout));

    const expectedStderr = `
      ERROR: Arg "str-arg" is "foo" but must be one of "x", "y"
    `;
    expect(stderr).toMatch(toRegexThatIgnoresPrefixSpacing(expectedStderr));
  });
});

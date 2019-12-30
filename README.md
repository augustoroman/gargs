@gargs
======

A simple args parsing library.

Example usage:
```ts
import { App, Flag, Arg } from 'gargs';

//
// Step 1: Define your app.
//
const app = new App('myprog', 'My cool program that does stuff', {
  flags: [
    Flag.bool('verbose', 'Moar log detail!')
      .env('VERBOSE'), // customize the flag to set from this env var
    Flag.bool('purchase', 'Order some cool things')
      .hide()        // doesn't show up in --help
      .def('true'),  // default to true 'cuz things are cool
  ],
}).withDefaultFlags();

//
// Step 2: Define some commands.
//
app.command('dosomething', 'Does a thing', {
  args: [
    Arg.string('thing', 'The thing to do')
      .require()                      // must specify a value
      .repeat()                       // multiple values are accumulated into an array
      .varName('things')              // customize the parsed variable name (plural)
      .allow('run', 'walk', 'laugh'), // only these values are allowed
  ],
  // Additional flags that apply to this command and its subcommands.
  flags: [
    Flag.string('speed', 'How fast to do things', 's')
      .def('normal')                 // default value
      .allow('normal', 'superfast'); // only allow specific values.
  ],
  // And define an action callback when this command is selected:
  action: async (args, flags) => {
    console.log(`Doing some actions (${args.things}) at speed ${flags.speed}.`);
  },
});

// More commands
app.command(...);
app.command(...);

// And subcommands:
const somecmd = app.command('cmd', ...); // myprog cmd
const sub = somecmd.command('sub', ...); // myprog cmd sub
sub.command('sub', ...);                 // myprog cmd sub sub
sub.command('sub2', ...);                // myprog cmd sub sub2

//
// Step 3: Parse the result & maybe use the default runner.
//

// Parsing is async
app.parse(process.argv, process.env).then((result) => {
  const { selected_cmd, args, flags, errors } = result;
  // ...do stuff based on the results.

  // want middleware? wrap result.command.action (if present) here.

  // or just use result.run():
  // - that will print help or errors and app.terminate() if appropriate,
  // - otherwise it'll run the action for the selected command.
  return result.run(flags.verbose);
}).catch((e) => {
  // parsing/action error
}).then(() => {
  // action success
}).finally(() => {
  // shutdown logic here (if not terminate() by run() printing help.
});
```

There are three steps to use bash completion:
1. Use `.withDefaultFlags()` on your App.
2. Run
   ```
   eval "$(your/script --completion-script-bash)"
   ```
   for each bash session or
   ```
   your/script --completion-script-bash >> ~/.bashrc
   ```
   to configure completion permanently.
3. Profit! Go forth and tab.

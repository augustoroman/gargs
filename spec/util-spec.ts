import { align, pad } from '../src/util';

describe('pad', () => {
  it('should pad a string', () => {
    expect(pad('foo', 5)).toEqual('foo  ');
    expect(pad('foo', 0)).toEqual('foo');
    expect(pad('foo', 3)).toEqual('foo');
    expect(pad('foo', 7)).toEqual('foo    ');
  });
});

describe('align', () => {
  it('should make lines without delimiters the same len', () => {
    expect(align([
      'some lines have longer cols', // input lines vary in length
      'longer & shorter cols',
      '1 2 3 4',
    ])).toEqual([
      'some lines have longer cols',
      'longer & shorter cols      ',
      '1 2 3 4                    ',
    ]);
  });
  it('should align lines with differnet numbers of delimiters', () => {
    expect(align(
      [
        'some\tlines have\tlonger cols', // input lines have varying number deliminters
        'longer\tshorter cols',
        '1\t2\t3\t4',
      ],
      { min: 0 },
    )).toEqual([
      'some     lines have     longer cols',
      'longer   shorter cols',
      '1        2              3             4',
    ]);
  });
  it('respect the options', () => {
    expect(align(
      [
        'some*lines have*longer cols', // all the options
        'longer*shorter cols',
        '1*2*3*4',
      ],
      { delim: '*', min: 3, padding: 1 },
    )).toEqual([
      'some   lines have   longer cols',
      'longer shorter cols',
      '1      2            3           4  ',
    ]);
  });
  it('should handle newlines in column entries', () => {
    expect(align(
      [
        'col1\tcol2\nline2\nline3\tcol3', // all the options
        'row2\trow2\trow2',
      ],
      { min: 4, padding: 1 },
    )).toEqual([
      'col1 col2  col3',
      '     line2     ',
      '     line3     ',
      'row2 row2  row2',
    ]);
    expect(align(
      [
        'col1\n\ncol1:\ncol1-note\tcol2\n  indented\nline3\tcol3', // all the options
        'row2\trow2\trow2\nrow2b',
      ],
      { min: 4, padding: 1 },
    )).toEqual([
      'col1      col2       col3 ',
      '            indented      ',
      'col1:     line3           ',
      'col1-note                 ',
      'row2      row2       row2 ',
      '                     row2b',
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  extractCitedSourceNumbers,
  removeCitationMarkers,
  StreamingCitationMarkerRemover,
} from './citation-markers.js';

describe('extractCitedSourceNumbers', () => {
  it('returns cited numbers in order of first appearance', () => {
    expect(extractCitedSourceNumbers('Leave is 20 days [2]. Notice is a month [1][2].', 3)).toEqual([2, 1]);
  });

  it('reads grouped markers', () => {
    expect(extractCitedSourceNumbers('Both apply [1, 3].', 3)).toEqual([1, 3]);
  });

  it('ignores numbers the model invented', () => {
    expect(extractCitedSourceNumbers('See [4] and [0].', 3)).toEqual([]);
  });

  it('ignores bracketed text that is not a marker', () => {
    expect(extractCitedSourceNumbers('An array [a, b] and a link [here](x).', 3)).toEqual([]);
  });

  it('works next to Bengali text', () => {
    expect(extractCitedSourceNumbers('ছুটি ২০ দিন [1]।', 1)).toEqual([1]);
  });
});

describe('removeCitationMarkers', () => {
  it('removes single, grouped and adjacent markers with the spaces before them', () => {
    expect(removeCitationMarkers('Leave is 20 days [2]. Notice is a month [1, 3][2].')).toBe(
      'Leave is 20 days. Notice is a month.',
    );
  });

  it('keeps bracketed text that is not a marker', () => {
    expect(removeCitationMarkers('An array [a, b] and a link [here](x).')).toBe(
      'An array [a, b] and a link [here](x).',
    );
  });
});

describe('StreamingCitationMarkerRemover', () => {
  function streamThrough(chunks: readonly string[]): { shown: string[]; text: string } {
    const remover = new StreamingCitationMarkerRemover();
    const shown = chunks.map((chunk) => remover.push(chunk));
    shown.push(remover.flush());
    return { shown, text: shown.join('') };
  }

  it('removes a marker split across chunks', () => {
    expect(streamThrough(['Leave is 20 days [', '2', '].', ' Done']).text).toBe('Leave is 20 days. Done');
  });

  it('removes a grouped marker split inside its list', () => {
    expect(streamThrough(['Both apply [1,', ' 3]', '.']).text).toBe('Both apply.');
  });

  it('holds back only the possible start of a marker', () => {
    expect(streamThrough(['Leave is 20 days [', '1].']).shown).toEqual(['Leave is 20 days', '.', '']);
  });

  it('shows ordinary brackets once they cannot be a marker', () => {
    expect(streamThrough(['Use the [', 'Leave] form [', '1']).text).toBe('Use the [Leave] form [1');
  });

  it('gives the same text however the answer is chunked', () => {
    const answer = 'Annual leave is 24 days [1]. Sick leave [2, 3] is separate; see [the form].';
    const characterChunks = Array.from(answer.matchAll(/./gsu), ([character]) => character);

    expect(streamThrough(characterChunks).text).toBe(removeCitationMarkers(answer));
  });
});

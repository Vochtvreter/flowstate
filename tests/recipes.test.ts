// What recipe a machine takes from what is wired into it, once later research exists (the rules review's F5),
// and Paradox's price in β (F6). Free play, mostly: the recipes that compete need γ.
import { describe, expect, it } from 'vitest';
import { connect, pickRecipe, placeNode } from '../src/actions';
import { TECHS } from '../src/content';
import { grantTech, research } from '../src/economy';
import { rich, run } from './helpers';

describe('a machine takes the recipe that fits what it is fed', () => {
  it('a Fabricator built from the Prism Assembler\'s port, after Dynamo research, makes Lens', () => {
    const g = rich();
    g.techs.push('P6', 'P8');
    const prism = placeNode(g, 'assembler', 400, 400, { recipe: 'prism' })!;
    const f = placeNode(g, 'fabricator', 600, 400)!;
    connect(g, prism.id, 0, f.id);
    expect(g.nodes.find((n) => n.id === f.id)!.recipe).toBe('lens');
  });

  it('an Assembler built from the Spark Refiner\'s port, after Reclamation, makes Glyph (what the Glyph card says)', () => {
    const g = rich();
    g.techs.push('P6');
    const spark = placeNode(g, 'refiner', 400, 400, { recipe: 'spark' })!;
    const a = placeNode(g, 'assembler', 600, 400)!;
    connect(g, spark.id, 0, a.id);
    expect(g.nodes.find((n) => n.id === a.id)!.recipe).toBe('glyph');
    // ...and one fed Clay makes Coil, Coil makes Dynamo: the recipe with the most of its inputs in what it gets.
    g.techs.push('P8');
    expect(pickRecipe(g, 'assembler', ['clay'])!.id).toBe('coil');
    expect(pickRecipe(g, 'assembler', ['spark', 'clay'])!.id).toBe('coil');
    expect(pickRecipe(g, 'fabricator', ['coil'])!.id).toBe('dynamo');
    expect(pickRecipe(g, 'fabricator', ['glyph', 'prism'])!.id).toBe('lens');
  });

  it('a Refiner wired from the Silt port before Reclamation picks Clay once Reclamation is researched', () => {
    const g = rich();
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    const r = placeNode(g, 'refiner', 600, 400)!;
    connect(g, ink.id, 1, r.id);
    expect(g.nodes.find((n) => n.id === r.id)!.recipe).toBeNull();
    // By research (the γ is handed over): at once.
    g.data = { a: 1e4, b: 1e4, g: 1e4 };
    expect(research(g, 'P6')).toBe(true);
    expect(g.nodes.find((n) => n.id === r.id)!.recipe).toBe('clay');
  });

  it('a tech that arrives any other way (a goal reward, a save) is picked up on the next tick', () => {
    const g = rich();
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    const r = placeNode(g, 'refiner', 600, 400)!;
    connect(g, ink.id, 1, r.id);
    g.techs.push('P6');
    run(g, 0.05);
    expect(g.nodes.find((n) => n.id === r.id)!.recipe).toBe('clay');
    // A machine with nothing wired into it stays blank; one with something it can never use does too.
    const blank = placeNode(g, 'assembler', 800, 400)!;
    const odd = placeNode(g, 'fabricator', 800, 600)!;
    connect(g, ink.id, 1, odd.id); // Silt into a Fabricator: no recipe takes it
    grantTech(g, 'P8');
    run(g, 0.05);
    expect(g.nodes.find((n) => n.id === blank.id)!.recipe).toBeNull();
    expect(g.nodes.find((n) => n.id === odd.id)!.recipe).toBeNull();
  });
});

describe('Paradox', () => {
  it('costs 250β: free play\'s last research is not a 37-minute save of the Data it has least of', () => {
    expect(TECHS.P9.cost).toEqual({ a: 2500, b: 250, g: 450 });
  });
});

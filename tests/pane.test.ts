import { expect, test } from 'claude-code/testing'

const SITE = { placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

test('the band shows the Skillverse button on every surface', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'skillverse',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
    })
    expect((await ui.find({ key: 'skillverse' }))?.props.label).toBe('Skillverse')
    await ui.unmount()
  }
})

test('the Skillverse pane draws its header once indexed', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'skillverse',
      surface,
      component: 'Pane',
      requestId: 'skillverse',
      props: { title: 'Skillverse', isFocused: false, bodyColumns: 100, ...SITE },
    })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /skills in \d+ groups/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the Skillverse pane is the tree with search, the web view and sized headings on every surface', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'skillverse',
      surface,
      component: 'Pane',
      requestId: 'skillverse',
      props: { title: 'Skillverse', isFocused: false, bodyColumns: 100, ...SITE },
    })
    await ui.redraw()
    expect(await ui.find({ key: 'publish' })).toBeDefined()
    expect(await ui.find({ key: 'reindex' })).toBeDefined()
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    // Headings are SVG at size on the desktop and Markdown in the terminal.
    if (surface === 'desktop') expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Skillverse')
    else expect(await ui.find({ type: 'Markdown', text: /Skillverse/ })).toBeDefined()
    await ui.unmount()
  }
})

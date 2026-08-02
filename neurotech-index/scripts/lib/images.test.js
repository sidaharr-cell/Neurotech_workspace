import { describe, it, expect } from 'vitest'
import {
  getImageSize, HI_RES, CARD_RES, SANE_ASPECT, isReusableLicense, firstFigureHref, europePmcFileUrl,
  articleCredit, preprintFigureHref, preprintServer, parseCommons, pickCompanyEntity,
  iconHref, recordText, classifyTechnology, titleAffirmsClass, pickClassImage, DEVICE_CLASSES,
  isRejected, productName, linkScore, pageLinks, hostNamesProduct, contentImage, sameName, productLikeNames,
} from './images.js'

describe('getImageSize', () => {
  it('reads a PNG header', () => {
    const buf = Buffer.alloc(32)
    buf[0] = 0x89; buf[1] = 0x50
    buf.writeUInt32BE(1280, 16); buf.writeUInt32BE(720, 20)
    expect(getImageSize(buf)).toEqual({ width: 1280, height: 720 })
  })

  it('returns null for something that is not an image', () => {
    expect(getImageSize(Buffer.from('not an image at all, just some bytes'))).toBeNull()
    expect(getImageSize(null)).toBeNull()
  })
})

describe('size gates', () => {
  it('holds the lead to a large picture', () => {
    expect(HI_RES({ width: 1200, height: 800 })).toBe(true)
    expect(HI_RES({ width: 700, height: 500 })).toBe(false)
  })

  it('lets a card take a journal figure, which is usually modest', () => {
    expect(CARD_RES({ width: 525, height: 383 })).toBe(true)
    expect(CARD_RES({ width: 200, height: 150 })).toBe(false)
  })
})

describe('isReusableLicense', () => {
  it('accepts the Creative Commons family and the public domain', () => {
    for (const l of ['cc by', 'CC BY-NC', 'CC BY-SA 4.0', 'CC0', 'Public domain']) {
      expect(isReusableLicense(l), l).toBe(true)
    }
  })

  it('refuses a paper with no licence at all', () => {
    expect(isReusableLicense(null)).toBe(false)
    expect(isReusableLicense('')).toBe(false)
    expect(isReusableLicense('All rights reserved')).toBe(false)
  })
})

describe('Europe PMC', () => {
  it('takes the graphic out of the first figure, not the first graphic on the page', () => {
    const xml = '<article><graphic xlink:href="logo"/><fig id="F1"><graphic xlink:href="F0001.jpg"/></fig></article>'
    expect(firstFigureHref(xml)).toBe('F0001.jpg')
  })

  it('adds the extension the JATS reference leaves off', () => {
    expect(firstFigureHref('<fig><graphic xlink:href="pone.0001-g001"/></fig>')).toBe('pone.0001-g001.jpg')
  })

  it('is null when the full text names no graphic', () => {
    expect(firstFigureHref('<article><p>text only</p></article>')).toBeNull()
    expect(firstFigureHref(null)).toBeNull()
  })

  it('builds the endpoint that serves the file', () => {
    expect(europePmcFileUrl('PMC13003872', 'F0001.jpg'))
      .toBe('https://europepmc.org/api/fulltextRepo?pprId=PMC13003872&type=FILE&fileName=F0001.jpg&mimeType=image/jpeg')
  })

  it('credits the article the figure came out of', () => {
    expect(articleCredit({ authorString: 'Card NS, Singer-Clark T, Peracha H.', journalTitle: 'Nature medicine', pubYear: '2026' }))
      .toBe('Card NS et al., Nature medicine, 2026')
  })
})

describe('preprints', () => {
  it('recognises the server from the DOI or the URL', () => {
    expect(preprintServer({ doi: '10.1101/2024.01.10.575051' })).toBe('biorxiv')
    expect(preprintServer({ url: 'https://www.medrxiv.org/content/10.1101/x' })).toBe('medrxiv')
    expect(preprintServer({ doi: '10.1038/s41591-026-04414-6' })).toBeNull()
  })

  it('finds the first figure on an article page', () => {
    const html = '<img src="https://www.biorxiv.org/content/biorxiv/early/2024/01/11/x/F1.large.jpg?width=800">'
    expect(preprintFigureHref(html)).toBe('https://www.biorxiv.org/content/biorxiv/early/2024/01/11/x/F1.large.jpg')
  })
})

describe('parseCommons', () => {
  const page = (over = {}) => ({
    query: {
      pages: {
        1: {
          title: 'File:EEG cap.jpg',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/a/EEG_cap.jpg',
            mime: 'image/jpeg',
            width: 4000,
            height: 3000,
            thumburl: 'https://upload.wikimedia.org/thumb/a/EEG_cap.jpg/1280px-EEG_cap.jpg',
            thumbwidth: 1280,
            thumbheight: 960,
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:EEG_cap.jpg',
            extmetadata: {
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              Artist: { value: '<a href="/wiki/User:X">Some Photographer</a>' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
            },
            ...over,
          }],
        },
      },
    },
  })

  it('prefers the thumbnail over a 4000px original', () => {
    const [img] = parseCommons(page())
    expect(img.url).toContain('1280px')
    expect(img).toMatchObject({ w: 1280, h: 960, license: 'CC BY-SA 4.0', subject: 'class' })
  })

  it('strips the markup out of the author credit', () => {
    expect(parseCommons(page())[0].credit).toBe('Some Photographer')
  })

  it('drops a file with no author, because the licence needs one', () => {
    expect(parseCommons(page({ extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } } }))).toHaveLength(0)
  })

  it('drops a file with no licence', () => {
    expect(parseCommons(page({ extmetadata: { Artist: { value: 'Someone' } } }))).toHaveLength(0)
  })

  it('drops a PDF the search returned from the file namespace', () => {
    expect(parseCommons(page({ mime: 'application/pdf' }))).toHaveLength(0)
  })

  it('drops anything too small to fill a card', () => {
    expect(parseCommons(page({ width: 320, thumburl: null }))).toHaveLength(0)
  })
})

describe('pickCompanyEntity', () => {
  const search = {
    search: [
      { id: 'Q180692', label: 'Synchron', description: 'hybrid form of swimming, dance and gymnastics' },
      { id: 'Q123', label: 'Synchron', description: 'American medical device company' },
    ],
  }

  it('skips the synchronised swimming entity for the medical device company', () => {
    expect(pickCompanyEntity(search, 'Synchron').id).toBe('Q123')
  })

  it('refuses a near-miss label rather than guess', () => {
    expect(pickCompanyEntity({ search: [{ id: 'Q1', label: 'Synchron Inc', description: 'company' }] }, 'Synchron')).toBeNull()
  })

  it('is null when nothing looks like a company', () => {
    expect(pickCompanyEntity({ search: [{ id: 'Q1', label: 'Axoft', description: 'village in Iran' }] }, 'Axoft')).toBeNull()
  })
})

describe('iconHref', () => {
  it('prefers the apple touch icon over a 16px favicon', () => {
    const html = '<link rel="icon" sizes="16x16" href="/fav.ico"><link rel="apple-touch-icon" href="/touch.png">'
    expect(iconHref(html)).toBe('/touch.png')
  })

  it('prefers the largest declared size when there is no touch icon', () => {
    const html = '<link rel="icon" sizes="32x32" href="/small.png"><link rel="icon" sizes="192x192" href="/big.png">'
    expect(iconHref(html)).toBe('/big.png')
  })

  it('is null on a page that declares none', () => {
    expect(iconHref('<html><head></head></html>')).toBeNull()
  })
})

describe('classifyTechnology', () => {
  it('reads a device through the FDA name for its product code', () => {
    const device = { name: 'Ceribell Brain Monitor Headband', product_code: 'OMC' }
    // On its own the name names no instrument at all; the product code is what
    // says what the device is.
    expect(classifyTechnology(device)).toBeNull()
    expect(classifyTechnology(device, 'Reduced-Montage Standard Electroencephalograph').id).toBe('eeg')
  })

  it('reads a trial through its interventions', () => {
    const trial = { title: 'A study in depression', metadata: { interventions: ['repetitive transcranial magnetic stimulation'] } }
    expect(classifyTechnology(trial).id).toBe('tms')
  })

  it('ignores the background prose, so a drug trial does not become a DBS photograph', () => {
    const trial = {
      title: 'A Study of Buntanetap in Participants With PD',
      summary: 'Unlike deep brain stimulation, this oral therapy targets…',
      metadata: { interventions: ['buntanetap'], conditions: ["Parkinson's Disease"] },
    }
    expect(classifyTechnology(trial)).toBeNull()
  })

  it('leaves a record with nothing neurological about it alone', () => {
    expect(classifyTechnology({ title: 'Remimazolam versus dexmedetomidine for sedation' })).toBeNull()
  })

  it('leaves a record that names no instrument alone, rather than reaching for a generic picture', () => {
    expect(classifyTechnology({ title: 'Gene regulatory innovations in cortical development' })).toBeNull()
  })

  it('reads the record fields and nothing else', () => {
    const text = recordText({ title: 'T', description: 'D', summary: 'S', metadata: { conditions: ['C'] } })
    expect(text).toContain('T')
    expect(text).not.toContain('S')
    expect(text).not.toContain('C')
  })
})

describe('titleAffirmsClass', () => {
  const cls = id => DEVICE_CLASSES.find(c => c.id === id)

  it('accepts a file whose name says what it shows', () => {
    expect(titleAffirmsClass('File:Anterior thoracic SCS.jpg', cls('scs'))).toBe(true)
  })

  it('refuses a cancer hyperthermia machine standing in for focused ultrasound', () => {
    expect(titleAffirmsClass('File:Hyperthermia Treatment For Cancer, Sonotherm 1000.jpg', cls('fus'))).toBe(false)
  })

  it('refuses the pun the search engine offered', () => {
    expect(titleAffirmsClass('File:Mea Culpa.JPG', cls('mea'))).toBe(false)
  })

  it('accepts hardware named for itself rather than for the procedure', () => {
    expect(titleAffirmsClass('File:Double cone coil.jpg', cls('tms'))).toBe(true)
  })
})

describe('pickClassImage', () => {
  const pool = { eeg: { images: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] } }

  it('gives a record the same picture every run', () => {
    expect(pickClassImage(pool, 'eeg', 'row-1')).toEqual(pickClassImage(pool, 'eeg', 'row-1'))
  })

  it('spreads records across the pool', () => {
    const picked = new Set(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(k => pickClassImage(pool, 'eeg', k).url))
    expect(picked.size).toBeGreaterThan(1)
  })

  it('is null for a class with no confirmed photograph', () => {
    expect(pickClassImage(pool, 'tms', 'row-1')).toBeNull()
    expect(pickClassImage({}, 'eeg', 'row-1')).toBeNull()
  })
})

describe('productName', () => {
  it('drops the second listed variant and the model numbers', () => {
    expect(productName({ name: 'Remote Wave Electrode (AE03-50); Remote Wave Electrode (AE03-60)' }))
      .toBe('Remote Wave Electrode')
  })

  it('keeps the words a product page would use', () => {
    expect(productName({ name: 'SPRINT PNS System' })).toBe('SPRINT PNS System')
    expect(productName({ name: 'BraiN20® (BraiN20)' })).toBe('BraiN20')
  })
})

describe('linkScore', () => {
  it('scores a link that carries the product name', () => {
    expect(linkScore('https://x.com/products/nerivio', 'Nerivio', 'Nerivio')).toBe(1)
  })

  it('ignores words that say nothing, like "system"', () => {
    expect(linkScore('https://x.com/sprint-pns', 'SPRINT PNS', 'SPRINT PNS System')).toBe(1)
  })

  it('scores an unrelated link at zero', () => {
    expect(linkScore('https://x.com/careers', 'Careers', 'Nerivio')).toBe(0)
  })
})

describe('pageLinks and hostNamesProduct', () => {
  const html = '<a href="/products/x">Product X</a><a href="https://nerivio.com/">Nerivio</a><a href="https://forbes.com/a">Press</a>'

  it('marks which links stay on the site', () => {
    const links = pageLinks(html, 'https://theranica.com')
    expect(links.map(l => l.internal)).toEqual([true, false, false])
  })

  it('follows a maker link to the product\'s own domain, and not to the press', () => {
    expect(hostNamesProduct('https://nerivio.com/', 'Nerivio')).toBe(true)
    expect(hostNamesProduct('https://forbes.com/a', 'Nerivio')).toBe(false)
  })
})

describe('contentImage', () => {
  it('prefers the Open Graph image', () => {
    const html = '<meta property="og:image" content="https://x.com/hero.jpg"><img src="/other.png">'
    expect(contentImage(html, 'https://x.com/p')).toBe('https://x.com/hero.jpg')
  })

  it('skips logos and icons', () => {
    expect(contentImage('<img src="/logo.png"><img src="/photos/device.jpg">', 'https://x.com/p'))
      .toBe('https://x.com/photos/device.jpg')
  })
})

describe('sameName', () => {
  it('ignores case, punctuation and a disambiguator', () => {
    expect(sameName('NeuroPace (company)', 'neuropace')).toBe(true)
    expect(sameName('Transcranial magnetic stimulation', 'Transcranial Magnetic Stimulation')).toBe(true)
  })

  it('refuses a different article', () => {
    expect(sameName('Migraine', 'Nerivio')).toBe(false)
  })
})

describe('productLikeNames', () => {
  it('takes the named product out of a trial\'s interventions', () => {
    expect(productLikeNames({ metadata: { interventions: ['Nerivio', 'placebo'] } })).toEqual(['Nerivio'])
  })

  it('leaves techniques to the class photographs', () => {
    expect(productLikeNames({ metadata: { interventions: ['repetitive transcranial magnetic stimulation'] } })).toEqual([])
  })

  it('ignores a description dressed up as an intervention', () => {
    expect(productLikeNames({ metadata: { interventions: ['standard of care physical therapy for six weeks'] } })).toEqual([])
  })
})

describe('SANE_ASPECT', () => {
  it('accepts the shapes a 4:3 card can crop', () => {
    expect(SANE_ASPECT({ width: 1280, height: 960 })).toBe(true)
    expect(SANE_ASPECT({ width: 756, height: 1280 })).toBe(true)
  })

  it('refuses a banner strip that would arrive as a sliver', () => {
    expect(SANE_ASPECT({ width: 916, height: 123 })).toBe(false)
  })

  it('refuses a column that would lose its subject to the crop', () => {
    expect(SANE_ASPECT({ width: 300, height: 1600 })).toBe(false)
  })
})

describe('isRejected', () => {
  it('remembers a picture a person turned down', () => {
    expect(isRejected('File:MRI accident on a 1.5 Tesla MR system.jpg')).toBe(true)
    expect(isRejected('File:Josh Universe Brain Computer Interface.jpg')).toBe(true)
  })

  it('leaves everything else alone', () => {
    expect(isRejected('File:EEG Recording Cap.jpg')).toBe(false)
  })
})

describe('recordText boundaries', () => {
  it('does not let a phrase span two separate fields', () => {
    const paper = {
      title: 'Magnetoelectric Nanoparticles Modulate Cortical Networks by Static Magnetic Fields',
      topics: ['Ultrasound', 'Neuromodulation', 'Wireless'],
    }
    // "ultrasound neuromodulation" exists only across the join, so the record
    // must not be read as a focused ultrasound paper.
    expect(classifyTechnology(paper)?.id).not.toBe('fus')
  })

  it('still reads a phrase that really is in one field', () => {
    expect(classifyTechnology({ title: 'Focused ultrasound neuromodulation of the thalamus' }).id).toBe('fus')
  })
})

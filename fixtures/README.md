# Adapter fixtures

Trimmed copies of real event pages, used by `tests/adapters.test.ts`. The markup
structure (`__NEXT_DATA__` paths, JSON-LD shape, og tags) is kept exactly as the
platforms serve it; names, ids, descriptions and image paths are replaced with
fictional values because this repo is public.

When a platform changes its markup, save a fresh page, keep only the fields the
adapter reads, anonymise, and update the expectations in the test.

| File | Source structure | Captured |
|---|---|---|
| `luma-event.html` | luma.com event page (`initialData.kind = "event"`) | 2026-09-30 |
| `partiful-event.html` | partiful.com/e/… page | 2026-09-30 |
| `generic-jsonld.html` | any page with a schema.org Event (Eventbrite-like) | synthetic |

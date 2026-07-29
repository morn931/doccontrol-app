import { Suspense } from 'react'
import RedlineWizard from './redline-wizard'

// Driveway C front door: any signed-in PPE person uploads site-redlined
// drawings (scan preferred, photo converted to PDF as last resort), checks and
// extends the markup in the in-app viewer, then submits the basket as a batch
// to Document Control. (Suspense: the wizard reads ?from= to route the user
// back to the CoreSHERQ dashboard they arrived from.)
export default function NewRedlinePage() {
  return <Suspense><RedlineWizard /></Suspense>
}

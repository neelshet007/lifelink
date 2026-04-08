/**
 * Blood Bank dashboard — re-uses the Hospital command-center page.
 * The hospital page already has conditional rendering for role === 'Blood Bank':
 *   - Shows "Blood Bank Command Center" badge
 *   - Enables/disables "Issue Blood" based on DCGI license
 *   - Shows DCGI license number in the summary bar
 */
export { default } from '../hospital/page';

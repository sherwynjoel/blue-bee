import { Global, Module } from '@nestjs/common';
import { GEOCODING_CONFIG, loadGeocodingConfig, type GeocodingConfig } from '../config/geocoding.config';
import { GEOCODER_PROVIDER } from './geocoder.provider';
import { NominatimGeocoder } from './nominatim.geocoder';

/**
 * Geocoding module (Increment 26) — binds the `GEOCODER_PROVIDER` token to a real implementation,
 * env-selected by `GEOCODER_PROVIDER` / `GOOGLE_MAPS_API_KEY` (see config/geocoding.config.ts).
 *
 * `@Global` so any feature module can inject the token without re-importing (mirrors RedisModule).
 * Exporting the TOKEN (not the class) is what lets an e2e `overrideProvider(GEOCODER_PROVIDER)` swap in
 * a deterministic fake — the tests must never hit OSM's servers.
 *
 * `google` is a documented, unbuilt branch: selecting it without a key already throws in
 * `loadGeocodingConfig`, so it fails at boot rather than at the first customer address.
 */
@Global()
@Module({
  providers: [
    { provide: GEOCODING_CONFIG, useFactory: loadGeocodingConfig },
    {
      provide: GEOCODER_PROVIDER,
      inject: [GEOCODING_CONFIG],
      useFactory: (config: GeocodingConfig) => {
        if (config.provider === 'google') {
          throw new Error('GEOCODER_PROVIDER=google is configured but the Google geocoder is not implemented yet');
        }
        return new NominatimGeocoder(config);
      },
    },
  ],
  exports: [GEOCODER_PROVIDER, GEOCODING_CONFIG],
})
export class GeocodingModule {}

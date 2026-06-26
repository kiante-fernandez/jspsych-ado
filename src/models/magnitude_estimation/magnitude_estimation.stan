// Stevens' power law for magnitude estimation (a CONTINUOUS-response model).
//
// A stimulus of physical magnitude s (e.g. the area of a circle) is shown and the
// participant estimates its perceived magnitude. Stevens' law says perceived
// magnitude is a power function of the physical one, psi = a * s^b, with estimation
// variability that is multiplicative (constant in log space). So in log-log:
//
//   log(estimate) ~ normal(loga + b * log(s), sigma)
//
// The headline parameter is the exponent b (e.g. ~0.7 for area, ~1 for length,
// ~3.5 for electric shock); loga is the scale and sigma the log-scale noise.
//
// The design covariate fed to Stan is log_s (the task supplies s; the JS adapter's
// buildData logs it), and the response is log_y = log(estimate). The ADO engine
// scores designs by integrating the predictive density (ado/mi_engine.js
// mutualInfoContinuous). Because the log-log likelihood is HOMOSCEDASTIC, EIG grows
// with the squared distance of log_s from the posterior intercept, so the MI-optimal
// magnitudes are the extreme ENDS of the range (classic D-optimality for a slope):
// under the prior, selection starts at the largest magnitude, and the low end only
// becomes informative once data locate the intercept. Interior magnitudes are rarely
// optimal, and sigma is identified as a by-product of accumulating trials rather than
// steered by the design.
data {
  int<lower=1> N;
  vector[N] log_s;   // log physical magnitude (design covariate)
  vector[N] log_y;   // log estimate (response)
}
parameters {
  real loga;            // log scale
  real b;               // Stevens exponent
  real<lower=0> sigma;  // log-scale estimation noise
}
model {
  loga ~ normal(0, 2);
  b ~ normal(0.7, 0.5);
  sigma ~ normal(0, 0.5);  // half-normal via <lower=0>; MUST match the JS adapter prior
  log_y ~ normal(loga + b * log_s, sigma);
}

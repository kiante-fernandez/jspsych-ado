data {
  int<lower=1> N;                         // number of completed comparison trials
  array[N] int<lower=0, upper=1> correct; // participant response accuracy: 1 = correct, 0 = incorrect

  array[N] int<lower=1> n_blue;           // blue-dot count shown on each completed trial
  array[N] int<lower=1> n_yellow;         // yellow-dot count shown on each completed trial
}

parameters {
  real<lower=0> w;                        // participant Weber fraction; lower values mean better acuity
}

transformed parameters {
  vector<lower=0, upper=1>[N] p_correct;  // predicted accuracy for each observed stimulus pair

  for (i in 1:N) {
    real n_large = max(n_blue[i], n_yellow[i]); // larger numerosity, independent of color
    real n_small = min(n_blue[i], n_yellow[i]); // smaller numerosity, independent of color
    real delta = n_large - n_small;             // absolute numerosity difference
    real sigma_delta = w * sqrt(square(n_large) + square(n_small)); // ANS noise for the difference

    p_correct[i] = Phi(delta / sigma_delta);
  }
}

model {
  // Prior centered near a typical starting ANS acuity estimate.
  w ~ lognormal(log(0.25), 0.5);

  correct ~ bernoulli(p_correct);
}

generated quantities {
  vector[N] log_lik;                      // pointwise log likelihood for external model checks
  array[N] int correct_rep;               // posterior predictive accuracy for completed trials

  for (i in 1:N) {
    log_lik[i] = bernoulli_lpmf(correct[i] | p_correct[i]);
    correct_rep[i] = bernoulli_rng(p_correct[i]);
  }
}

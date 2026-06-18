data {
  int<lower=1> N;

  vector[N] t_ss;
  vector[N] t_ll;

  vector[N] r_ss;
  vector[N] r_ll;

  array[N] int<lower=0, upper=1> y; // 1 = choose LL
}
parameters {
  real<lower=0> k;
  real<lower=0> tau;
}
transformed parameters {
  vector[N] v_ss;
  vector[N] v_ll;

  v_ss = r_ss ./ (1 + k * t_ss);
  v_ll = r_ll ./ (1 + k * t_ll);
}
model {
  // weakly informative priors
  k ~ lognormal(-4, 2);
  tau ~ lognormal(0, 1);

  y ~ bernoulli_logit(tau * (v_ll - v_ss));
}
generated quantities {
  vector[N] p_ll;

  for (n in 1 : N)
    p_ll[n] = inv_logit(tau * (v_ll[n] - v_ss[n]));
}

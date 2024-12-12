import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("MultiRoundBettingETH", function () {
  async function deployFixture() {
    const [owner, userA, userB, userC] = await ethers.getSigners();
    const MultiRoundBettingETH = await ethers.getContractFactory("MultiRoundBettingETH", owner);
    const betting = await MultiRoundBettingETH.deploy(500); // 5% fee
    await betting.waitForDeployment();
    return { owner, userA, userB, userC, betting };
  }

  async function getBalance(address: string) {
    return await ethers.provider.getBalance(address);
  }

  it("Should allow deposits and close betting", async () => {
    const { userA, userB, betting } = await loadFixture(deployFixture);

    await betting.connect(userA).deposit(true, { value: ethers.parseEther("1") });
    await betting.connect(userB).deposit(false, { value: ethers.parseEther("2") });

    let round = await betting.rounds(1);
    expect(round.bettingOpen).to.equal(true);

    await betting.closeBetting();
    round = await betting.rounds(1);
    expect(round.bettingOpen).to.equal(false);
  });

  it("Should prevent zero deposits", async () => {
    const { userA, betting } = await loadFixture(deployFixture);
    await expect(
      betting.connect(userA).deposit(true, { value: 0n })
    ).to.be.revertedWith("Zero deposit");
  });

  it("Should prevent team switching mid-round", async () => {
    const { userA, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(true, { value: ethers.parseEther("1") });
    await expect(
      betting.connect(userA).deposit(false, { value: ethers.parseEther("1") })
    ).to.be.revertedWith("Team switch");
  });

  it("No losers scenario", async () => {
    const { userA, userB, betting } = await loadFixture(deployFixture);

    await betting.connect(userA).deposit(true, { value: ethers.parseEther("2") });
    await betting.connect(userB).deposit(true, { value: ethers.parseEther("1") });
    await betting.closeBetting();
    await betting.settleBet(true);

    const balBeforeA = await getBalance(await userA.getAddress());
    await betting.connect(userA).claimAllWinnings();
    const balAfterA = await getBalance(await userA.getAddress());
    expect(balAfterA - balBeforeA).to.be.greaterThan(0n);

    const balBeforeB = await getBalance(await userB.getAddress());
    await betting.connect(userB).claimAllWinnings();
    const balAfterB = await getBalance(await userB.getAddress());
    expect(balAfterB - balBeforeB).to.be.greaterThan(0n);
  });

  it("No winners scenario", async () => {
    const { userA, userB, betting } = await loadFixture(deployFixture);

    await betting.connect(userA).deposit(true, { value: ethers.parseEther("1.5") });
    await betting.connect(userB).deposit(true, { value: ethers.parseEther("1.5") });
    await betting.closeBetting();
    // Suppose B wins but no one bet B -> no winners
    await betting.settleBet(false);

    const balBeforeA = await getBalance(await userA.getAddress());
    await betting.connect(userA).claimAllWinnings();
    const balAfterA = await getBalance(await userA.getAddress());
    expect(balAfterA - balBeforeA).to.be.greaterThan(0n);

    const balBeforeB = await getBalance(await userB.getAddress());
    await betting.connect(userB).claimAllWinnings();
    const balAfterB = await getBalance(await userB.getAddress());
    expect(balAfterB - balBeforeB).to.be.greaterThan(0n);
  });

  it("Should not settle twice", async () => {
    const { userA, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(true, { value: ethers.parseEther("1") });
    await betting.closeBetting();
    await betting.settleBet(true);
    await expect(betting.settleBet(true)).to.be.revertedWith("Settled");
  });

  it("Multiple rounds scenario", async () => {
    const { userA, userB, betting } = await loadFixture(deployFixture);

    // Round 1: Team A wins
    await betting.connect(userA).deposit(true, { value: ethers.parseEther("0.5") });  // User A bets on A
    await betting.connect(userB).deposit(false, { value: ethers.parseEther("0.5") }); // User B bets on B
    await betting.closeBetting();
    await betting.settleBet(true); // A wins R1
    await betting.startNewRound();

    // Verify round 1 state
    const round1 = await betting.rounds(1);
    expect(round1.bettingOpen).to.equal(false);
    expect(round1.settled).to.equal(true);
    expect(round1.winnerA).to.equal(true);

    // Round 2: Team B will win, so both must bet on B (false) to gain profits
    await betting.connect(userA).deposit(false, { value: ethers.parseEther("1") });   // User A bets on B
    await betting.connect(userB).deposit(false, { value: ethers.parseEther("2") });   // User B also bets on B now
    await betting.closeBetting();
    await betting.settleBet(false); // B wins R2

    // Verify round 2 state
    const round2 = await betting.rounds(2);
    expect(round2.bettingOpen).to.equal(false);
    expect(round2.settled).to.equal(true);
    expect(round2.winnerA).to.equal(false);

    const balBeforeA = await getBalance(await userA.getAddress());
    await betting.connect(userA).claimAllWinnings();
    const balAfterA = await getBalance(await userA.getAddress());
    expect(balAfterA - balBeforeA).to.be.greaterThan(0n, "User A should gain from winning rounds");

    const balBeforeB = await getBalance(await userB.getAddress());
    await betting.connect(userB).claimAllWinnings();
    const balAfterB = await getBalance(await userB.getAddress());
    expect(balAfterB - balBeforeB).to.be.greaterThan(0n, "User B should gain from winning round 2");
  });

  it("Claiming twice yields nothing second time", async () => {
    const { userA, userB, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(true, { value: ethers.parseEther("1") });
    await betting.connect(userB).deposit(false, { value: ethers.parseEther("1") });
    await betting.closeBetting();
    await betting.settleBet(true);

    await betting.connect(userA).claimAllWinnings();
    await expect(betting.connect(userA).claimAllWinnings()).to.be.revertedWith("Nothing");
  });

  it("Cannot claim before settlement", async () => {
    const { userA, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(true, { value: ethers.parseEther("1") });
    await expect(betting.connect(userA).claimAllWinnings()).to.be.revertedWith("Nothing");
  });

  it("Check fee collection after settlement", async () => {
    const { userA, owner, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(true, { value: ethers.parseEther("1") });
    await betting.closeBetting();
    await betting.settleBet(true);

    const balBeforeOwner = await getBalance(await owner.getAddress());
    await betting.withdrawAllFees();
    const balAfterOwner = await getBalance(await owner.getAddress());
    expect(balAfterOwner - balBeforeOwner).to.be.greaterThan(0n);
  });

  it("Cannot withdraw fees before settlement", async () => {
    const { userA, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(true, { value: ethers.parseEther("1") });
    await expect(betting.withdrawAllFees()).to.be.revertedWith("No fees");
  });

  it("Large deposits test", async () => {
    const { userA, userB, betting } = await loadFixture(deployFixture);
    await betting.connect(userA).deposit(true, { value: ethers.parseEther("5") });
    await betting.connect(userB).deposit(false, { value: ethers.parseEther("3") });
    await betting.closeBetting();
    await betting.settleBet(true); // A wins

    const balBeforeA = await getBalance(await userA.getAddress());
    await betting.connect(userA).claimAllWinnings();
    const balAfterA = await getBalance(await userA.getAddress());
    expect(balAfterA - balBeforeA).to.be.greaterThan(0n);
  });
});
